import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

function getStoredTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      let active: 'light' | 'dark'
      if (theme === 'system') {
        active = media.matches ? 'dark' : 'light'
      } else {
        active = theme
      }
      root.classList.toggle('dark', active === 'dark')
    }

    applyTheme()
    localStorage.setItem('theme', theme)

    if (theme === 'system') {
      media.addEventListener('change', applyTheme)
      return () => media.removeEventListener('change', applyTheme)
    }
  }, [theme])

  const toggle = () => {
    setTheme((prev) => {
      if (prev === 'system') return 'light'
      if (prev === 'light') return 'dark'
      return 'system'
    })
  }

  return { theme, toggle, setTheme }
}
