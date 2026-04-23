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
  launchOptions?: LaunchOptions
  contextOptions?: BrowserContextOptions
  initScripts?: string[]
  userAgent?: string
  proxySettings?: ProxySettings
}
