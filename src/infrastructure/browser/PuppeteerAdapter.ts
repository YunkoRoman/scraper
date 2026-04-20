import type { Page } from 'playwright'
import type { BrowserAdapter } from './BrowserAdapter.js'

export class PuppeteerAdapter implements BrowserAdapter {
  async launch(): Promise<void> {
    throw new Error(
      'PuppeteerAdapter not implemented. Install puppeteer and implement this adapter.',
    )
  }

  async newPage(): Promise<Page> {
    throw new Error('PuppeteerAdapter not implemented.')
  }

  async close(): Promise<void> {}
}
