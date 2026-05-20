import { describe, it, expect } from 'vitest'

// Pure logic extracted from useSettings: compute active theme
function resolveTheme(
  theme: 'light' | 'dark' | 'system',
  systemDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

describe('resolveTheme', () => {
  it('returns dark when system dark and theme=system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
  })
  it('returns light when system light and theme=system', () => {
    expect(resolveTheme('system', false)).toBe('light')
  })
  it('returns explicit theme regardless of system', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
