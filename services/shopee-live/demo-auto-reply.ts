/**
 * Demo: Auto-reply bot for Shopee Live
 *
 * This standalone script:
 * 1. Polls Shopee Live chat via OpenClaw
 * 2. When a new user message is detected, sends it to an LLM
 * 3. Posts the AI reply back to the chat
 *
 * Usage:
 *   npx tsx --env-file=.env.local demo-auto-reply.ts
 *
 * Required env vars:
 *   OPENCLAW_TOKEN, OPENCLAW_CONTROL_URL, OPENCLAW_PROFILE
 *   OPENAI_API_KEY or OPENAI_BASE_URL (for LLM)
 */
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultConfig } from './src/config/types'
import { parseChatMessages, parseStreamStats } from './src/services/chat-parser'
import { OpenClawBrowser } from './src/services/openclaw-browser'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
const browser = new OpenClawBrowser(config.openclaw)
const products: Product[] = JSON.parse(
  readFileSync(resolve(__dirname, 'src/data/products.json'), 'utf-8'),
)

const seenMessages = new Set<string>()

const SYSTEM_PROMPT = `你是「AI代理小舖」的蝦皮直播主播助手。你的任務是和觀眾互動、推銷商品。

你的商品清單：
${products.map(p => `- ${p.name}: NT$${p.price} (${p.discount}) — ${p.description}`).join('\n')}

規則：
- 回覆要簡短有趣，不超過 50 字
- 用繁體中文回覆
- 當觀眾問價格、功能時，引用商品資料回答
- 當觀眾打招呼時，熱情歡迎並推薦主打商品
- 適時說「連結在上方，現在下單還有折扣喔！」
- 不要回覆系統訊息（如「歡迎來到蝦皮直播」）
`

async function callLLM(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (!apiKey) {
    console.error('[demo] OPENAI_API_KEY not set, using echo reply')
    return `收到！你說的是「${userMessage}」對吧？歡迎來到直播間～`
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 100,
      temperature: 0.8,
    }),
  })

  const data = await res.json() as any
  return data.choices?.[0]?.message?.content || '感謝留言！'
}

async function pollAndReply() {
  try {
    const snapshot = await browser.snapshot()
    const messages = parseChatMessages(snapshot)
    const stats = parseStreamStats(snapshot)

    for (const msg of messages) {
      const key = `${msg.username}:${msg.content}`
      if (seenMessages.has(key))
        continue
      seenMessages.add(key)

      // Skip system messages
      if (msg.username === 'system')
        continue

      console.log(`[chat] ${msg.username}: ${msg.content}`)

      // Generate AI reply
      const reply = await callLLM(`${msg.username} 說：${msg.content}`)
      console.log(`[reply] → ${reply}`)

      // Send reply to chat
      try {
        await browser.sendChatMessage(reply)
        console.log('[sent] ✓')
      }
      catch (err) {
        console.error('[sent] ✗', err)
      }

      // Wait between replies to avoid spam
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  catch (err) {
    console.error('[poll] Error:', err)
  }
}

async function main() {
  console.log('[demo] Shopee Live Auto-Reply Bot')
  console.log(`[demo] OpenClaw: ${config.openclaw.controlUrl}`)
  console.log(`[demo] Profile: ${config.openclaw.profile}`)
  console.log(`[demo] Products: ${products.length} items`)
  console.log('[demo] Starting... (Ctrl+C to stop)\n')

  // Initial snapshot to verify connection
  const targetId = await browser.getTargetId()
  console.log(`[demo] Found Shopee tab: ${targetId}`)

  const snapshot = await browser.snapshot()
  const stats = parseStreamStats(snapshot)
  console.log(`[demo] Stream: "${stats.title}" | Viewers: ${stats.viewers} | Duration: ${stats.duration}\n`)

  // Poll every 3 seconds
  setInterval(pollAndReply, 3000)
  pollAndReply()
}

main().catch((err) => {
  console.error('[demo] Fatal:', err)
  process.exit(1)
})
