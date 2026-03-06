import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'
import { tool } from '@xsai/tool'
import { z } from 'zod'

interface CallToolResult {
  content: { type: string, text: string }[]
  isError: boolean
}

interface McpTool {
  name: string
  description: string
  inputSchema: {
    required: string[]
    title: string
    type: 'object'
    properties: Record<string, { title: string, type: string, default?: any }>
  }
}

// ── Platform-agnostic MCP bridge ──

let _bridge: McpBridge | undefined

interface McpBridge {
  connectServer: (command: string, args: string[]) => Promise<void>
  disconnectServer: () => Promise<void>
  listTools: () => Promise<McpTool[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
}

function isElectron(): boolean {
  return !!(globalThis as any).window?.electron?.ipcRenderer
}

async function createElectronBridge(): Promise<McpBridge> {
  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')

  // Mirror the eventa definitions from stage-tamagotchi shared/eventa.ts
  const electronMcpConnect = defineInvokeEventa<void, { command: string, args: string[] }>('eventa:invoke:electron:mcp:connect')
  const electronMcpDisconnect = defineInvokeEventa('eventa:invoke:electron:mcp:disconnect')
  const electronMcpListTools = defineInvokeEventa<McpTool[]>('eventa:invoke:electron:mcp:list-tools')
  const electronMcpCallTool = defineInvokeEventa<CallToolResult, { name: string, args?: Record<string, unknown> }>('eventa:invoke:electron:mcp:call-tool')

  const ipcRenderer = (globalThis as any).window.electron.ipcRenderer
  const { context } = createContext(ipcRenderer)

  const invokeConnect = defineInvoke(context, electronMcpConnect)
  const invokeDisconnect = defineInvoke(context, electronMcpDisconnect)
  const invokeListTools = defineInvoke(context, electronMcpListTools)
  const invokeCallTool = defineInvoke(context, electronMcpCallTool)

  return {
    connectServer: (command, args) => invokeConnect({ command, args }),
    disconnectServer: () => invokeDisconnect(),
    listTools: () => invokeListTools(),
    callTool: (name, args) => invokeCallTool({ name, args }),
  }
}

async function createTauriBridge(): Promise<McpBridge> {
  const { connectServer, disconnectServer, listTools, callTool } = await import('@proj-airi/tauri-plugin-mcp')
  return { connectServer, disconnectServer, listTools, callTool }
}

async function getBridge(): Promise<McpBridge> {
  if (!_bridge) {
    _bridge = isElectron()
      ? await createElectronBridge()
      : await createTauriBridge()
  }
  return _bridge
}

const tools = [
  tool({
    name: 'mcp_list_tools',
    description: 'List all tools available on the MCP server',
    execute: async (_, __) => {
      const bridge = await getBridge()
      return await bridge.listTools()
    },
    parameters: z.object({}).strict(),
  }),
  tool({
    name: 'mcp_connect_server',
    description: 'Connect to the MCP server. If "success", the connection to the MCP server is successful. Otherwise, the connection fails.',
    execute: async ({ command, args }) => {
      const bridge = await getBridge()
      await bridge.connectServer(command, args)
      return 'success'
    },
    parameters: z.object({
      command: z.string().describe('The command to connect to the MCP server'),
      args: z.array(z.string()).describe('The arguments to pass to the MCP server'),
    }).strict(),
  }),
  tool({
    name: 'mcp_disconnect_server',
    description: 'Disconnect from the MCP server. If "success", the disconnection from the MCP server is successful. Otherwise, the disconnection fails.',
    execute: async () => {
      const bridge = await getBridge()
      await bridge.disconnectServer()
      return 'success'
    },
    parameters: z.object({}).strict(),
  }),
  tool({
    name: 'mcp_call_tool',
    description: 'Call a tool on the MCP server. The result is a list of content and a boolean indicating whether the tool call is an error.',
    execute: async ({ name, parameters }) => {
      const bridge = await getBridge()
      const parametersObject = Object.fromEntries(parameters.map(({ name, value }) => [name, value]))
      const result = await bridge.callTool(name, parametersObject)
      return result satisfies {
        content: {
          type: string
          text: string
        }[]
        isError: boolean
      }
    },
    parameters: z.object({
      name: z.string().describe('The name of the tool to call'),
      parameters: z.array(z.object({
        name: z.string().describe('The name of the parameter'),
        value: z.union([z.string(), z.number(), z.boolean(), z.object({}).strict()]).describe('The value of the parameter, it can be a string, a number, a boolean, or an object'),
      }).strict()).describe('The parameters to pass to the tool'),
    }),
  }),
]

export const mcp = async () => Promise.all(tools)
