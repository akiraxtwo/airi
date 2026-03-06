import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { OpenClawConfig } from '../config/types'

const execFileAsync = promisify(execFile)

export interface BrowserTab {
  targetId: string
  title: string
  url: string
  wsUrl: string
  type: string
}

export interface SnapshotResult {
  ok: boolean
  format: string
  targetId: string
  url: string
  snapshot: string
  refs: Record<string, { role: string, name?: string }>
}

export interface ActResult {
  ok: boolean
}

export class OpenClawBrowser {
  private config: OpenClawConfig
  private cachedTargetId: string | undefined

  constructor(config: OpenClawConfig) {
    this.config = config
    this.cachedTargetId = config.targetId
  }

  private baseArgs(): string[] {
    const args = ['browser', '--json', '--token', this.config.token]
    if (this.config.profile) {
      args.push('--browser-profile', this.config.profile)
    }
    return args
  }

  private async exec(subcommand: string, extraArgs: string[] = []): Promise<string> {
    const args = [...this.baseArgs(), subcommand, ...extraArgs]
    const { stdout } = await execFileAsync('openclaw', args, { timeout: 30_000 })
    return stdout.trim()
  }

  async listTabs(): Promise<BrowserTab[]> {
    const raw = await this.exec('tabs')
    const data = JSON.parse(raw) as { tabs: BrowserTab[] }
    return data.tabs
  }

  async findShopeeTab(): Promise<string | undefined> {
    const tabs = await this.listTabs()
    const shopeeTab = tabs.find(t =>
      t.url.includes('live.shopee.tw')
      || t.url.includes('live.shopee.com'),
    )
    return shopeeTab?.targetId
  }

  async getTargetId(): Promise<string> {
    if (this.cachedTargetId)
      return this.cachedTargetId

    const targetId = await this.findShopeeTab()
    if (!targetId)
      throw new Error('No Shopee Live tab found in browser. Please open https://live.shopee.tw/pc/setup')

    this.cachedTargetId = targetId
    return targetId
  }

  async focus(): Promise<void> {
    const targetId = await this.getTargetId()
    await this.exec('focus', [targetId])
  }

  async snapshot(): Promise<SnapshotResult> {
    const targetId = await this.getTargetId()
    await this.focus()
    const raw = await this.exec('snapshot')
    return JSON.parse(raw) as SnapshotResult
  }

  async click(ref: string): Promise<ActResult> {
    await this.focus()
    await this.exec('click', [ref])
    return { ok: true }
  }

  async type(ref: string, text: string): Promise<ActResult> {
    await this.focus()
    await this.exec('type', [ref, text])
    return { ok: true }
  }

  async press(key: string): Promise<ActResult> {
    await this.focus()
    await this.exec('press', [key])
    return { ok: true }
  }

  async sendChatMessage(text: string): Promise<void> {
    // 1. Get target and focus once
    const targetId = await this.getTargetId()
    await this.exec('focus', [targetId])

    // 2. Snapshot to find refs (skip redundant focus)
    const raw = await this.exec('snapshot')
    const snapshot = JSON.parse(raw) as SnapshotResult
    const { findChatControls } = await import('../services/chat-parser')
    const controls = findChatControls(snapshot)

    if (!controls.inputRef || !controls.sendButtonRef)
      throw new Error(`Cannot find chat controls. inputRef=${controls.inputRef}, sendButtonRef=${controls.sendButtonRef}`)

    // 3. Click input → type → click send (single focus already done)
    await this.exec('click', [controls.inputRef])
    await sleep(300)
    await this.exec('type', [controls.inputRef, text])
    await sleep(300)
    await this.exec('click', [controls.sendButtonRef])
  }

  clearTargetCache(): void {
    this.cachedTargetId = undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
