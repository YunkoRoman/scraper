import { describe, it, expect } from 'vitest'
import { ProxyPoolService } from '../infrastructure/proxy/ProxyPoolService.js'

describe('ProxyPoolService', () => {
  it('round-robins through entries', () => {
    const pool = new ProxyPoolService(['http://a:1', 'http://b:2', 'http://c:3'])
    expect(pool.next()).toBe('http://a:1')
    expect(pool.next()).toBe('http://b:2')
    expect(pool.next()).toBe('http://c:3')
    expect(pool.next()).toBe('http://a:1')
  })
  it('returns undefined when empty', () => {
    const pool = new ProxyPoolService([])
    expect(pool.next()).toBeUndefined()
  })
  it('ignores blank lines and trims', () => {
    const pool = new ProxyPoolService(['  http://a:1  ', '', 'http://b:2'])
    expect(pool.next()).toBe('http://a:1')
    expect(pool.next()).toBe('http://b:2')
  })
})
