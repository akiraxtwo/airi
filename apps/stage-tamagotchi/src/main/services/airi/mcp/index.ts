import type { ChildProcess } from 'node:child_process'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import {
  electronMcpCallTool,
  electronMcpConnect,
  electronMcpDisconnect,
  electronMcpListTools,
} from '../../../../shared/eventa'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: any
  error?: { code: number, message: string, data?: any }
}

export function setupMcpService() {
  const log = useLogg('main/mcp').useGlobalConfig()
  const { context } = createContext(ipcMain)

  const REQUEST_TIMEOUT_MS = 60_000

  let childProcess: ChildProcess | null = null
  let readlineInterface: ReturnType<typeof createInterface> | null = null
  let requestId = 0
  const pendingRequests = new Map<number, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  function sendRequest(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!childProcess?.stdin) {
      return Promise.reject(new Error('MCP server not connected'))
    }

    const id = ++requestId
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, REQUEST_TIMEOUT_MS)

      pendingRequests.set(id, { resolve, reject, timer })
      childProcess!.stdin!.write(`${JSON.stringify(request)}\n`)
    })
  }

  function handleResponse(line: string) {
    try {
      const response: JsonRpcResponse = JSON.parse(line)
      if (response.id == null)
        return // notification, ignore

      const pending = pendingRequests.get(response.id)
      if (!pending)
        return

      pendingRequests.delete(response.id)
      clearTimeout(pending.timer)
      if (response.error) {
        pending.reject(new Error(response.error.message))
      }
      else {
        pending.resolve(response.result)
      }
    }
    catch {
      // not JSON-RPC, ignore
    }
  }

  function cleanup() {
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('MCP server disconnected'))
    }
    pendingRequests.clear()
    readlineInterface?.close()
    readlineInterface = null
    childProcess = null
  }

  // ── IPC Handlers ──

  defineInvokeHandler(context, electronMcpConnect, async (payload) => {
    if (childProcess) {
      throw new Error('MCP server already connected')
    }

    const { command, args, cwd } = payload
    log.log('Connecting to MCP server', { command, args, cwd })

    childProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: process.platform === 'win32',
      cwd: cwd || undefined,
    })

    readlineInterface = createInterface({ input: childProcess.stdout! })
    readlineInterface.on('line', handleResponse)

    childProcess.on('exit', (code) => {
      log.log('MCP server exited', { code })
      cleanup()
    })

    childProcess.on('error', (err) => {
      log.withError(err).error('MCP server process error')
      cleanup()
    })

    // Initialize MCP handshake
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'airi-electron', version: '0.1.0' },
    })
    log.log('MCP initialized', { serverInfo: initResult?.serverInfo })

    // Send initialized notification (no id)
    childProcess.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  })

  defineInvokeHandler(context, electronMcpDisconnect, async () => {
    if (!childProcess) {
      throw new Error('MCP server not connected')
    }

    log.log('Disconnecting from MCP server')
    childProcess.kill()
    cleanup()
  })

  defineInvokeHandler(context, electronMcpListTools, async () => {
    const result = await sendRequest('tools/list')
    return result?.tools ?? []
  })

  defineInvokeHandler(context, electronMcpCallTool, async (payload) => {
    log.log('Calling MCP tool', { name: payload.name })
    const result = await sendRequest('tools/call', {
      name: payload.name,
      arguments: payload.args,
    })
    return result ?? { content: [], isError: false }
  })

  onAppBeforeQuit(() => {
    if (childProcess) {
      log.log('Cleaning up MCP child process')
      childProcess.kill()
      cleanup()
    }
  })
}
