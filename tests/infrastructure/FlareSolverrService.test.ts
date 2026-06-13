import { describe, it, expect } from 'vitest'
import {
  makeSolveCFSnippet,
  validateFlareSolverrUrl,
} from '../../src/infrastructure/flaresolverr/FlareSolverrService'

const AsyncFn = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>

describe('validateFlareSolverrUrl', () => {
  it('accepts empty string (feature disabled)', () => {
    expect(() => validateFlareSolverrUrl('')).not.toThrow()
  })

  it('accepts valid http URL', () => {
    expect(() => validateFlareSolverrUrl('http://localhost:8191')).not.toThrow()
  })

  it('accepts valid https URL', () => {
    expect(() => validateFlareSolverrUrl('https://byparr.example.com')).not.toThrow()
  })

  it('rejects file:// protocol', () => {
    expect(() => validateFlareSolverrUrl('file:///etc/passwd')).toThrow('http or https')
  })

  it('rejects malformed URL', () => {
    expect(() => validateFlareSolverrUrl('not-a-url')).toThrow('not a valid URL')
  })
})

describe('makeSolveCFSnippet', () => {
  it('contains async solveCF arrow function', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('const solveCF = async')
  })

  it('embeds the provided URL', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('http://localhost:8191')
  })

  it('solveCF accepts optional options argument', async () => {
    const snippet = makeSolveCFSnippet('')
    const fn = new AsyncFn(snippet + '\nreturn typeof solveCF')
    const result = await fn()
    expect(result).toBe('function')
  })

  it('merges options into request body (options visible in snippet)', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('...options')
  })

  it('throws descriptive error when FLARESOLVERR_URL not set', async () => {
    const snippet = makeSolveCFSnippet('')
    const fn = new AsyncFn(snippet + '\nreturn await solveCF("https://example.com")')
    await expect(fn()).rejects.toThrow('FLARESOLVERR_URL')
  })

  it('throws connection error when solver unreachable', async () => {
    const snippet = makeSolveCFSnippet('http://localhost:1')
    const fn = new AsyncFn(snippet + '\nreturn await solveCF("https://example.com")')
    await expect(fn()).rejects.toThrow('cannot reach solver')
  })
})
