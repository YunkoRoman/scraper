import { describe, it, expect } from 'vitest'
import { LinkDeduplicator } from '../../src/domain/services/LinkDeduplicator.js'

describe('LinkDeduplicator', () => {
  it('returns all links on first call', () => {
    const dedup = new LinkDeduplicator()
    expect(dedup.filter(['https://a.com', 'https://b.com'])).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })

  it('filters already-seen links', () => {
    const dedup = new LinkDeduplicator()
    dedup.filter(['https://a.com'])
    expect(dedup.filter(['https://a.com', 'https://b.com'])).toEqual(['https://b.com'])
  })

  it('normalizes trailing slash', () => {
    const dedup = new LinkDeduplicator()
    dedup.filter(['https://a.com/page'])
    expect(dedup.filter(['https://a.com/page/'])).toEqual([])
  })

  it('when disabled returns all links', () => {
    const dedup = new LinkDeduplicator(false)
    dedup.filter(['https://a.com'])
    expect(dedup.filter(['https://a.com'])).toEqual(['https://a.com'])
  })

  it('seed pre-populates seen set so seeded URLs are filtered out', () => {
    const dedup = new LinkDeduplicator()
    dedup.seed(['https://a.com/page', 'https://b.com'])
    const result = dedup.filter(['https://a.com/page', 'https://c.com'])
    expect(result).toEqual(['https://c.com'])
  })

  it('seed respects URL normalization', () => {
    const dedup = new LinkDeduplicator()
    dedup.seed(['https://a.com/page/'])   // trailing slash variant
    expect(dedup.filter(['https://a.com/page'])).toEqual([])
  })
})
