import type { Page, Browser } from 'puppeteer'
import type { BrowserAdapter } from './BrowserAdapter.js'

export class PuppeteerAdapter implements BrowserAdapter<Page> {
  private browser: Browser | null = null

  async launch(): Promise<void> {
    const puppeteer = await import('puppeteer')
    this.browser = await puppeteer.default.launch({ headless: true })
  }

  async newPage(): Promise<Page> {
    if (!this.browser) throw new Error('PuppeteerAdapter not launched')
    return this.browser.newPage()
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
  }
}
