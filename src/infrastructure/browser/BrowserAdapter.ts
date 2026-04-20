import type { Page } from 'playwright'
import type { BrowserType } from '../../domain/value-objects/StepSettings.js'
import { PlaywrightAdapter } from './PlaywrightAdapter.js'
import { PuppeteerAdapter } from './PuppeteerAdapter.js'

export interface BrowserAdapter {
  launch(): Promise<void>
  newPage(): Promise<Page>
  close(): Promise<void>
}

export function createBrowserAdapter(browserType?: BrowserType): BrowserAdapter {
  if (browserType === 'puppeteer') return new PuppeteerAdapter()
  return new PlaywrightAdapter()
}
