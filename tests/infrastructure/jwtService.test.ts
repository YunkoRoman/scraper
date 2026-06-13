import { describe, it, expect, beforeAll } from 'vitest'
import { signToken, verifyToken } from '../../src/infrastructure/auth/jwtService.js'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-for-vitest-at-least-32-chars'
})

describe('jwtService', () => {
  it('round-trips the payload through sign + verify', () => {
    const token = signToken({ userId: 'u1', orgId: 'o1', role: 'admin' })
    const decoded = verifyToken(token)
    expect(decoded.userId).toBe('u1')
    expect(decoded.orgId).toBe('o1')
    expect(decoded.role).toBe('admin')
  })

  it('throws when the token is tampered with', () => {
    const token = signToken({ userId: 'u1', orgId: 'o1', role: 'coworker' })
    expect(() => verifyToken(token + 'x')).toThrow()
  })

  it('throws on a non-token string', () => {
    expect(() => verifyToken('not-a-jwt')).toThrow()
  })
})
