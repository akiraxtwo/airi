import process from 'node:process'

import { getDefaultConfig } from './config/types'
import { ShopeeLiveMCPAdapter } from './adapters/mcp-adapter'

async function main() {
  const config = getDefaultConfig()

  if (!config.openclaw.token) {
    console.error('[shopee-live] Error: OPENCLAW_TOKEN is required.')
    console.error('[shopee-live] Set it via environment variable or .env.local file.')
    process.exit(1)
  }

  console.log('[shopee-live] Starting Shopee Live MCP Server...')
  console.log(`[shopee-live] OpenClaw control: ${config.openclaw.controlUrl}`)
  console.log(`[shopee-live] Browser profile: ${config.openclaw.profile}`)
  console.log(`[shopee-live] MCP port: ${config.mcp.port}`)

  const adapter = new ShopeeLiveMCPAdapter(config)

  const shutdown = async () => {
    console.log('[shopee-live] Shutting down...')
    await adapter.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await adapter.start()
    console.log('[shopee-live] Ready! Waiting for MCP connections...')
  }
  catch (error) {
    console.error('[shopee-live] Failed to start:', error)
    process.exit(1)
  }
}

main()
