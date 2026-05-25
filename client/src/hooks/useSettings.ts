import { useEffect, useState } from 'react'

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  pageLimit: 10 | 25 | 50
  defaultBrowserType: 'playwright' | 'playwright-stealth' | 'puppeteer'
  defaultRetryCount: number
  defaultConcurrentQuota: number | null
  defaultDeduplication: boolean
  navCollapsed: boolean
}

const DEFAULTS: AppSettings = {
  theme: 'system',
  pageLimit: 10,
  defaultBrowserType: 'playwright',
  defaultRetryCount: 5,
  defaultConcurrentQuota: null,
  defaultDeduplication: true,
  navCollapsed: false,
}

const KEY = 'app-settings'
const SYNC_EVENT = 'app-settings-changed'

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore parse errors */ }
  return { ...DEFAULTS }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load)

  useEffect(() => {
    const handler = () => setSettings(load)
    window.addEventListener(SYNC_EVENT, handler)
    return () => window.removeEventListener(SYNC_EVENT, handler)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const active =
        settings.theme === 'system'
          ? media.matches ? 'dark' : 'light'
          : settings.theme
      root.classList.toggle('dark', active === 'dark')
    }
    apply()
    if (settings.theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [settings.theme])

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      localStorage.setItem(KEY, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent(SYNC_EVENT))
      return next
    })
  }

  return { settings, updateSettings }
}
