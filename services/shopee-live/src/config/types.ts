export interface OpenClawConfig {
  /** Gateway auth token */
  token: string
  /** Browser profile name (empty string = no filter) */
  profile: string
  /** Target tab ID (auto-detected if not set) */
  targetId?: string
}

export interface ShopeeConfig {
  /** Polling interval in ms for chat messages */
  pollIntervalMs: number
  /** Max messages to keep in memory */
  maxMessages: number
}

export interface Config {
  openclaw: OpenClawConfig
  shopee: ShopeeConfig
  mcp: {
    port: number
  }
}

export function getDefaultConfig(): Config {
  return {
    openclaw: {
      token: process.env.OPENCLAW_TOKEN || '',
      profile: process.env.OPENCLAW_PROFILE || '',
    },
    shopee: {
      pollIntervalMs: 2000,
      maxMessages: 100,
    },
    mcp: {
      port: Number(process.env.MCP_PORT) || 8081,
    },
  }
}
