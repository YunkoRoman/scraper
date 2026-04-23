import type { BrowserType, StepSettings } from '../../domain/value-objects/StepSettings.js'
import { PlaywrightAdapter } from './PlaywrightAdapter.js'
import { PlaywrightStealthAdapter } from './PlaywrightStealthAdapter.js'
import { PuppeteerAdapter } from './PuppeteerAdapter.js'

export interface BrowserAdapter<P> {
  launch(): Promise<void>
  newPage(): Promise<P>
  close(): Promise<void>
}

export function createBrowserAdapter(browserType: 'puppeteer', settings?: StepSettings): BrowserAdapter<import('puppeteer').Page>
export function createBrowserAdapter(browserType?: 'playwright' | 'playwright-stealth' | undefined, settings?: StepSettings): BrowserAdapter<import('playwright').Page>
export function createBrowserAdapter(browserType?: BrowserType, settings?: StepSettings): BrowserAdapter<import('playwright').Page | import('puppeteer').Page>
export function createBrowserAdapter(browserType?: BrowserType, settings?: StepSettings): BrowserAdapter<unknown> {
  if (browserType === 'puppeteer') return new PuppeteerAdapter()
  if (browserType === 'playwright-stealth') return new PlaywrightStealthAdapter(settings?.launchOptions, settings?.contextOptions)
  return new PlaywrightAdapter(settings?.launchOptions, settings?.contextOptions)
}
