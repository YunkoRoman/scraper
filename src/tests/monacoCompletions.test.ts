import { describe, it, expect } from 'vitest'
import { buildPlaywrightCompletionItems, buildTaskCompletionItems } from '../../client/src/lib/monacoPlaywrightCompletions.ts'

describe('buildPlaywrightCompletionItems', () => {
  it('returns 20 Page method completions', () => {
    const items = buildPlaywrightCompletionItems()
    expect(items.length).toBeGreaterThanOrEqual(20)
    expect(items.map(i => i.label)).toContain('goto')
    expect(items.map(i => i.label)).toContain('$$eval')
  })
  it('each item has insertText and detail', () => {
    for (const item of buildPlaywrightCompletionItems()) {
      expect(item.label).toBeTypeOf('string')
      expect(item.insertText).toBeTypeOf('string')
      expect(item.detail).toBeTypeOf('string')
    }
  })
})

describe('buildTaskCompletionItems', () => {
  it('returns url and parent_data', () => {
    const labels = buildTaskCompletionItems().map(i => i.label)
    expect(labels).toEqual(['url', 'parent_data'])
  })
})
