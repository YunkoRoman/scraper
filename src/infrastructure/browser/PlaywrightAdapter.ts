import { chromium, type Browser, type BrowserContext, type Page, type LaunchOptions, type BrowserContextOptions } from 'playwright'
import type { BrowserAdapter } from './BrowserAdapter.js'

export class PlaywrightAdapter implements BrowserAdapter<Page> {
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  constructor(
    private readonly launchOptions: LaunchOptions = {},
    private readonly contextOptions: BrowserContextOptions = {},
  ) {}

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true, ...this.launchOptions })
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...this.contextOptions,
    })
  }

  async addInitScript(script: string): Promise<void> {
    if (!this.context) throw new Error('PlaywrightAdapter not launched')
    await this.context.addInitScript(script)
  }

  async newPage(): Promise<Page> {
    if (!this.context) throw new Error('PlaywrightAdapter not launched')
    return this.context.newPage()
  }

  async close(): Promise<void> {
    await this.context?.close()
    await this.browser?.close()
    this.context = null
    this.browser = null
  }
}
