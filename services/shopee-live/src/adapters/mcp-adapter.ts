import type { Config } from '../config/types'
import type { ChatMessage } from '../services/chat-parser'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { z } from 'zod'

import { parseStreamStats } from '../services/chat-parser'
import { ChatPoller } from '../services/chat-poller'
import { OpenClawBrowser } from '../services/openclaw-browser'

interface Product {
  id: string
  name: string
  price: number
  currency: string
  description: string
  stock: number
  discount: string
  keywords: string[]
}

export class ShopeeLiveMCPAdapter {
  private mcpServer: McpServer
  private app: ReturnType<typeof createApp>
  private server: ReturnType<typeof createServer> | null = null
  private activeTransports: SSEServerTransport[] = []
  private config: Config
  private browser: OpenClawBrowser
  private poller: ChatPoller
  private products: Product[]

  constructor(config: Config) {
    this.config = config
    this.browser = new OpenClawBrowser(config.openclaw)
    this.poller = new ChatPoller(this.browser, config.shopee)

    // Load products
    const __dirname = dirname(fileURLToPath(import.meta.url))
    this.products = JSON.parse(
      readFileSync(resolve(__dirname, '../data/products.json'), 'utf-8'),
    )

    this.mcpServer = new McpServer({
      name: 'Shopee Live Service',
      version: '0.1.0',
    })

    this.app = createApp()
    this.configureServer()
    this.setupRoutes()
  }

  private configureServer(): void {
    // ── Resources ──

    this.mcpServer.resource(
      'chat-latest',
      new ResourceTemplate('shopee://chat/latest', {
        list: async () => ({
          resources: [{
            name: 'chat-latest',
            uri: 'shopee://chat/latest',
            description: 'Latest Shopee Live chat messages',
          }],
        }),
      }),
      async (uri) => {
        const messages = this.poller.getMessages(20)
        return {
          contents: [{
            uri: uri.href,
            text: messages.map(m => `${m.username}: ${m.content}`).join('\n') || '(no messages yet)',
          }],
        }
      },
    )

    this.mcpServer.resource(
      'products',
      new ResourceTemplate('shopee://products', {
        list: async () => ({
          resources: [{
            name: 'products',
            uri: 'shopee://products',
            description: 'Products available in this live stream',
          }],
        }),
      }),
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: JSON.stringify(this.products, null, 2),
        }],
      }),
    )

    this.mcpServer.resource(
      'stream-status',
      new ResourceTemplate('shopee://stream/status', {
        list: async () => ({
          resources: [{
            name: 'stream-status',
            uri: 'shopee://stream/status',
            description: 'Current live stream status',
          }],
        }),
      }),
      async (uri) => {
        try {
          const snapshot = await this.browser.snapshot()
          const stats = parseStreamStats(snapshot)
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(stats, null, 2),
            }],
          }
        }
        catch {
          return { contents: [{ uri: uri.href, text: '{"error": "Failed to get stream status"}' }] }
        }
      },
    )

    // ── Tools ──

    this.mcpServer.tool(
      'shopee_get_messages',
      { limit: z.number().optional().describe('Number of recent messages to return (default: 20)') },
      async ({ limit }) => {
        // Trigger an immediate poll
        await this.poller.poll()
        const messages = this.poller.getMessages(limit || 20)
        return {
          content: [{
            type: 'text',
            text: messages.length > 0
              ? messages.map(m => `[${m.username}] ${m.content}`).join('\n')
              : '(no messages yet)',
          }],
        }
      },
    )

    this.mcpServer.tool(
      'shopee_send_reply',
      { text: z.string().describe('The reply text to send in chat (max 150 chars)') },
      async ({ text }) => {
        try {
          await this.browser.sendChatMessage(text.slice(0, 150))
          return {
            content: [{ type: 'text', text: `Sent: ${text}` }],
          }
        }
        catch (error) {
          return {
            content: [{ type: 'text', text: `Failed to send reply: ${error}` }],
            isError: true,
          }
        }
      },
    )

    this.mcpServer.tool(
      'shopee_get_viewers',
      {},
      async () => {
        try {
          const snapshot = await this.browser.snapshot()
          const stats = parseStreamStats(snapshot)
          return {
            content: [{
              type: 'text',
              text: `Viewers: ${stats.viewers}, Likes: ${stats.likes}, Shares: ${stats.shares}, Duration: ${stats.duration}`,
            }],
          }
        }
        catch (error) {
          return {
            content: [{ type: 'text', text: `Failed to get viewers: ${error}` }],
            isError: true,
          }
        }
      },
    )

    this.mcpServer.tool(
      'shopee_get_products',
      { query: z.string().optional().describe('Search keyword to filter products') },
      async ({ query }) => {
        let results = this.products
        if (query) {
          const q = query.toLowerCase()
          results = this.products.filter(p =>
            p.name.toLowerCase().includes(q)
            || p.keywords.some(k => k.toLowerCase().includes(q))
            || p.description.toLowerCase().includes(q),
          )
        }

        return {
          content: [{
            type: 'text',
            text: results.length > 0
              ? results.map(p =>
                `[${p.id}] ${p.name} - NT$${p.price} (${p.discount}) | 庫存: ${p.stock}\n  ${p.description}`,
              ).join('\n\n')
              : 'No products found',
          }],
        }
      },
    )

    this.mcpServer.tool(
      'shopee_get_product_detail',
      { id: z.string().describe('Product ID') },
      async ({ id }) => {
        const product = this.products.find(p => p.id === id)
        if (!product) {
          return {
            content: [{ type: 'text', text: `Product not found: ${id}` }],
            isError: true,
          }
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(product, null, 2),
          }],
        }
      },
    )
  }

  private setupRoutes(): void {
    const router = createRouter()

    router.use('*', defineEventHandler((event) => {
      event.node.res.setHeader('Access-Control-Allow-Origin', '*')
      event.node.res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      event.node.res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (event.node.req.method === 'OPTIONS') {
        event.node.res.statusCode = 204
        event.node.res.end()
      }
    }))

    router.get('/sse', defineEventHandler(async (event) => {
      const { req, res } = event.node
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const transport = new SSEServerTransport('/messages', res)
      this.activeTransports.push(transport)

      req.on('close', () => {
        const index = this.activeTransports.indexOf(transport)
        if (index !== -1)
          this.activeTransports.splice(index, 1)
      })

      await this.mcpServer.connect(transport)
    }))

    router.post('/messages', defineEventHandler(async (event) => {
      if (this.activeTransports.length === 0) {
        event.node.res.statusCode = 503
        return { error: 'No active SSE connections' }
      }

      try {
        const body = await readBody(event)
        const transport = this.activeTransports[this.activeTransports.length - 1]
        return await transport.handleMessage(body)
      }
      catch (error) {
        event.node.res.statusCode = 500
        return { error: String(error) }
      }
    }))

    router.get('/', defineEventHandler(() => ({
      name: 'Shopee Live MCP Service',
      version: '0.1.0',
      endpoints: {
        sse: '/sse',
        messages: '/messages',
      },
    })))

    this.app.use(router)
  }

  async start(): Promise<void> {
    // Start polling chat messages
    this.poller.start()

    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(toNodeListener(this.app))
        this.server.on('error', reject)
        this.server.listen(this.config.mcp.port, () => {
          console.log(`[shopee-live] MCP Server started at http://localhost:${this.config.mcp.port}`)
          console.log(`[shopee-live] SSE endpoint: http://localhost:${this.config.mcp.port}/sse`)
          resolve()
        })
      }
      catch (error) {
        reject(error)
      }
    })
  }

  async stop(): Promise<void> {
    this.poller.stop()
    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        this.server = null
        console.log('[shopee-live] MCP Server stopped')
        resolve()
      })
    })
  }
}

async function readBody(event: any): Promise<any> {
  const buffers: Buffer[] = []
  for await (const chunk of event.node.req)
    buffers.push(chunk)
  return JSON.parse(Buffer.concat(buffers).toString())
}
