import { describe, it, expect } from 'vitest'
import { hashPassword, comparePassword } from '../../src/infrastructure/auth/hashPassword.js'

describe('hashPassword', () => {
  it('produces a hash different from the plaintext', async () => {
    const hash = await hashPassword('Sup3rSecret!pw')
    expect(hash).not.toBe('Sup3rSecret!pw')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('comparePassword returns true for the correct password', async () => {
    const hash = await hashPassword('Sup3rSecret!pw')
    expect(await comparePassword('Sup3rSecret!pw', hash)).toBe(true)
  })

  it('comparePassword returns false for the wrong password', async () => {
    const hash = await hashPassword('Sup3rSecret!pw')
    expect(await comparePassword('wrong-password', hash)).toBe(false)
  })
})
