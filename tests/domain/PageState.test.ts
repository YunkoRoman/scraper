import { describe, it, expect } from 'vitest'
import { PageState, isTerminal } from '../../src/domain/value-objects/PageState.js'

describe('PageState', () => {
  it('pending, success, failed, aborted are terminal', () => {
    expect(isTerminal(PageState.Success)).toBe(true)
    expect(isTerminal(PageState.Failed)).toBe(true)
    expect(isTerminal(PageState.Aborted)).toBe(true)
    expect(isTerminal(PageState.Pending)).toBe(false)
    expect(isTerminal(PageState.Retry)).toBe(false)
  })
})
