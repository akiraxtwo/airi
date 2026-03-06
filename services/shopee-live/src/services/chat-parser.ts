import type { SnapshotResult } from './openclaw-browser'

export interface ChatMessage {
  id: string
  username: string
  content: string
  timestamp: number
}

export interface StreamStats {
  viewers: number
  likes: number
  shares: number
  duration: string
  title: string
}

/**
 * Parse chat messages from Shopee Live ARIA snapshot.
 *
 * Shopee Live chat structure (from actual snapshot):
 * - paragraph "評論"
 * - grid "grid" [ref=eXXX]:
 *   - rowgroup:
 *     - generic [cursor=pointer]:
 *       - generic: (avatar)
 *       - text: "username: message content"
 */
export function parseChatMessages(snapshot: SnapshotResult): ChatMessage[] {
  const messages: ChatMessage[] = []
  const lines = snapshot.snapshot.split('\n')

  let inChatGrid = false
  let inRowGroup = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect the chat grid section (after "評論")
    if (trimmed.includes('grid "grid"'))
      inChatGrid = true

    if (inChatGrid && trimmed.includes('rowgroup'))
      inRowGroup = true

    // Chat messages appear as text nodes or generic nodes inside the rowgroup
    if (inRowGroup) {
      // Match lines like: - text: 歡迎來到蝦皮直播! 祝您玩得開心。
      // Or: - generic [ref=eXXX]: username: message
      const textMatch = trimmed.match(/^-\s+text:\s+(.+)$/)
      const genericTextMatch = trimmed.match(/^-\s+generic\s+\[ref=\w+\]:\s+(.+)$/)

      const content = textMatch?.[1] || genericTextMatch?.[1]
      if (content && !content.startsWith('"') && content.length > 0) {
        // Try to split "username: message" format
        const colonIndex = content.indexOf(': ')
        if (colonIndex > 0 && colonIndex < 30) {
          messages.push({
            id: `msg-${Date.now()}-${messages.length}`,
            username: content.slice(0, colonIndex).trim(),
            content: content.slice(colonIndex + 2).trim(),
            timestamp: Date.now(),
          })
        }
        else {
          // System message (e.g. "歡迎來到蝦皮直播!")
          messages.push({
            id: `msg-${Date.now()}-${messages.length}`,
            username: 'system',
            content: content.trim(),
            timestamp: Date.now(),
          })
        }
      }
    }

    // Stop parsing after we leave the chat section
    if (inRowGroup && trimmed.includes('textbox'))
      break
  }

  return messages
}

/**
 * Parse stream statistics from Shopee Live ARIA snapshot.
 *
 * Structure:
 * - heading "即時直播數據"
 * - list:
 *   - listitem: "1" / "觀看者"
 *   - listitem: "0" / "讚"
 *   - listitem: "0" / "分享"
 *
 * Title and duration in banner:
 * - generic "Telesin" [ref=eXXX]
 * - generic: "00:00:54"
 */
export function parseStreamStats(snapshot: SnapshotResult): StreamStats {
  const lines = snapshot.snapshot.split('\n')
  const stats: StreamStats = {
    viewers: 0,
    likes: 0,
    shares: 0,
    duration: '00:00:00',
    title: '',
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Title: generic "Telesin" [ref=eXXX]
    const titleMatch = trimmed.match(/^-\s+generic\s+"([^"]+)"\s+\[ref=\w+\]$/)
    if (titleMatch && !stats.title)
      stats.title = titleMatch[1]

    // Duration: 00:00:54
    const durationMatch = trimmed.match(/:\s+"?(\d{2}:\d{2}:\d{2})"?/)
    if (durationMatch)
      stats.duration = durationMatch[1]

    // Stats: look for pattern "N" followed by label
    if (trimmed.includes('觀看者')) {
      const numLine = lines[i - 1]?.trim()
      const numMatch = numLine?.match(/"(\d+)"/)
      if (numMatch)
        stats.viewers = Number.parseInt(numMatch[1])
    }

    if (trimmed.includes('讚') && !trimmed.includes('分享')) {
      const numLine = lines[i - 1]?.trim()
      const numMatch = numLine?.match(/"(\d+)"/)
      if (numMatch)
        stats.likes = Number.parseInt(numMatch[1])
    }

    if (trimmed.includes('分享')) {
      const numLine = lines[i - 1]?.trim()
      const numMatch = numLine?.match(/"(\d+)"/)
      if (numMatch)
        stats.shares = Number.parseInt(numMatch[1])
    }
  }

  return stats
}

/**
 * Find the chat input textbox ref and send button ref from snapshot.
 */
export function findChatControls(snapshot: SnapshotResult): { inputRef?: string, sendButtonRef?: string, pinRef?: string } {
  const result: { inputRef?: string, sendButtonRef?: string, pinRef?: string } = {}

  for (const [ref, info] of Object.entries(snapshot.refs)) {
    if (info.role === 'textbox' && !info.name)
      result.inputRef = ref
    if (info.role === 'button' && info.name === '發送')
      result.sendButtonRef = ref
    if (info.role === 'button' && info.name === 'Pin')
      result.pinRef = ref
  }

  return result
}
