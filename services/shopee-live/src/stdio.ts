/**
 * Stdio transport entry point for AIRI's tauri-plugin-mcp.
 *
 * AIRI spawns this as a child process and communicates via stdin/stdout (JSON-RPC).
 * The chat poller runs in the background and OpenClaw is accessed via HTTP.
 */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { getDefaultConfig } from './config/types'
import { parseStreamStats } from './services/chat-parser'
import { ChatPoller } from './services/chat-poller'
import { OpenClawBrowser } from './services/openclaw-browser'

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

const config = getDefaultConfig()

if (!config.openclaw.token) {
  process.stderr.write('[shopee-live] Error: OPENCLAW_TOKEN is required\n')
  process.exit(1)
}

const browser = new OpenClawBrowser(config.openclaw)
const poller = new ChatPoller(browser, config.shopee)

const __dirname = dirname(fileURLToPath(import.meta.url))
const products: Product[] = JSON.parse(
  readFileSync(resolve(__dirname, 'data/products.json'), 'utf-8'),
)

const server = new McpServer({
  name: 'Shopee Live Service',
  version: '0.1.0',
})

// ── Resources ──

server.resource(
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
    const messages = poller.getMessages(20)
    return {
      contents: [{
        uri: uri.href,
        text: messages.map(m => `${m.username}: ${m.content}`).join('\n') || '(no messages yet)',
      }],
    }
  },
)

server.resource(
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
      text: JSON.stringify(products, null, 2),
    }],
  }),
)

server.resource(
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
      const snapshot = await browser.snapshot()
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

server.tool(
  'shopee_get_messages',
  { limit: z.number().optional().describe('Number of recent messages to return (default: 20)') },
  async ({ limit }) => {
    await poller.poll()
    const messages = poller.getMessages(limit || 20)
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

server.tool(
  'shopee_send_reply',
  { text: z.string().describe('The reply text to send in chat (max 150 chars)') },
  async ({ text }) => {
    try {
      process.stderr.write(`[shopee-live] Sending reply: "${text.slice(0, 50)}..."\n`)
      await browser.sendChatMessage(text.slice(0, 150))
      process.stderr.write(`[shopee-live] Reply sent successfully\n`)
      return { content: [{ type: 'text', text: `Sent: ${text}` }] }
    }
    catch (error) {
      process.stderr.write(`[shopee-live] Send reply error: ${error}\n`)
      return { content: [{ type: 'text', text: `Failed to send reply: ${error}` }], isError: true }
    }
  },
)

server.tool(
  'shopee_get_viewers',
  {},
  async () => {
    try {
      const snapshot = await browser.snapshot()
      const stats = parseStreamStats(snapshot)
      return {
        content: [{
          type: 'text',
          text: `Viewers: ${stats.viewers}, Likes: ${stats.likes}, Shares: ${stats.shares}, Duration: ${stats.duration}`,
        }],
      }
    }
    catch (error) {
      return { content: [{ type: 'text', text: `Failed: ${error}` }], isError: true }
    }
  },
)

server.tool(
  'shopee_get_products',
  { query: z.string().optional().describe('Search keyword to filter products') },
  async ({ query }) => {
    let results = products
    if (query) {
      const q = query.toLowerCase()
      results = products.filter(p =>
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

server.tool(
  'shopee_get_product_detail',
  { id: z.string().describe('Product ID') },
  async ({ id }) => {
    const product = products.find(p => p.id === id)
    if (!product)
      return { content: [{ type: 'text', text: `Product not found: ${id}` }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(product, null, 2) }] }
  },
)

// ── Start ──

poller.start()

const transport = new StdioServerTransport()
await server.connect(transport)

process.stderr.write('[shopee-live] MCP Server started (stdio mode)\n')
