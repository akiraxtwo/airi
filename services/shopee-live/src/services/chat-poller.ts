import type { ShopeeConfig } from '../config/types'
import type { ChatMessage } from './chat-parser'
import type { OpenClawBrowser } from './openclaw-browser'

import { parseChatMessages } from './chat-parser'

export class ChatPoller {
  private browser: OpenClawBrowser
  private config: ShopeeConfig
  private messages: ChatMessage[] = []
  private seenContents = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private onNewMessage?: (msg: ChatMessage) => void

  constructor(browser: OpenClawBrowser, config: ShopeeConfig) {
    this.browser = browser
    this.config = config
  }

  setOnNewMessage(callback: (msg: ChatMessage) => void): void {
    this.onNewMessage = callback
  }

  async poll(): Promise<ChatMessage[]> {
    try {
      const snapshot = await this.browser.snapshot()
      const parsed = parseChatMessages(snapshot)
      const newMessages: ChatMessage[] = []

      for (const msg of parsed) {
        const key = `${msg.username}:${msg.content}`
        if (!this.seenContents.has(key)) {
          this.seenContents.add(key)
          this.messages.push(msg)
          newMessages.push(msg)
          this.onNewMessage?.(msg)
        }
      }

      // Trim old messages
      if (this.messages.length > this.config.maxMessages) {
        const removed = this.messages.splice(0, this.messages.length - this.config.maxMessages)
        for (const msg of removed)
          this.seenContents.delete(`${msg.username}:${msg.content}`)
      }

      return newMessages
    }
    catch (error) {
      console.error('[shopee-live] Poll error:', error)
      return []
    }
  }

  start(): void {
    if (this.timer)
      return
    console.log(`[shopee-live] Starting chat poller (interval: ${this.config.pollIntervalMs}ms)`)
    this.timer = setInterval(() => this.poll(), this.config.pollIntervalMs)
    // Poll immediately on start
    this.poll()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[shopee-live] Chat poller stopped')
    }
  }

  getMessages(limit?: number): ChatMessage[] {
    if (limit)
      return this.messages.slice(-limit)
    return [...this.messages]
  }

  getNewMessagesSince(timestamp: number): ChatMessage[] {
    return this.messages.filter(m => m.timestamp > timestamp)
  }
}
