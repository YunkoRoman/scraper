import { describe, it, expect } from 'vitest'
import { makeSolveCFSnippet } from '../../src/infrastructure/flaresolverr/FlareSolverrService'

describe('makeSolveCFSnippet', () => {
  it('returns a string containing an async solveCF function declaration', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('async function solveCF')
  })

  it('embeds the provided URL into the snippet', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('http://localhost:8191')
  })

  it('snippet defines a callable function when evaluated', async () => {
    const snippet = makeSolveCFSnippet('')
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => () => Promise<unknown>
    expect(() => new AsyncFunction(snippet + '\nreturn typeof solveCF')).not.toThrow()
  })

  it('calling solveCF with no FLARESOLVERR_URL throws descriptive error', async () => {
    const snippet = makeSolveCFSnippet('')
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => () => Promise<unknown>
    const fn = new AsyncFunction(snippet + '\nreturn await solveCF("https://example.com")')
    await expect(fn()).rejects.toThrow('FLARESOLVERR_URL')
  })
})
