import type { LaunchOptions, BrowserContextOptions } from 'playwright'

export type BrowserType = 'playwright' | 'playwright-stealth' | 'puppeteer'

export interface ProxySettings {
  host: string
  port: string
  username?: string
  password?: string
}

export interface StepSettings {
  browser_type?: BrowserType
  concurrency?: number
  /** Minimum delay in ms between page requests (randomized up to pageDelayMax) */
  pageDelayMin?: number
  /** Maximum delay in ms between page requests */
  pageDelayMax?: number
  /** Close and relaunch the browser context after this many pages (0 = never) */
  maxPagesPerContext?: number
  launchOptions?: LaunchOptions
  contextOptions?: BrowserContextOptions
  initScripts?: string[]
  userAgent?: string
  proxySettings?: ProxySettings
}
