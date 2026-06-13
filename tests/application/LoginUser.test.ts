import { describe, it, expect, vi, beforeAll } from 'vitest'
import { loginUser } from '../../src/application/auth/LoginUser.js'
import type { AuthDb } from '../../src/application/auth/RegisterOrganization.js'
import { AuthError } from '../../src/application/auth/AuthError.js'
import { hashPassword, comparePassword } from '../../src/infrastructure/auth/hashPassword.js'

let storedHash: string
beforeAll(async () => {
  storedHash = await hashPassword('correct-horse1!')
})

function makeDb(record: unknown): AuthDb {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(record),
    createOrgAndUser: vi.fn(),
    hashPassword: vi.fn(),
    comparePassword: vi
      .fn()
      .mockImplementation(async (plain, hash) => comparePassword(plain, hash)),
  } as unknown as AuthDb
}

describe('loginUser', () => {
  it('throws 401 when the email is unknown', async () => {
    const db = makeDb(null)
    await expect(
      loginUser(db, { email: 'nobody@x.com', password: 'whatever12345!' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('throws 401 when the password does not match', async () => {
    const db = makeDb({
      id: 'u1',
      organizationId: 'o1',
      fullName: 'A',
      email: 'a@x.com',
      passwordHash: storedHash,
      role: 'admin',
      status: 'active',
    })
    await expect(
      loginUser(db, { email: 'a@x.com', password: 'wrong-password1!' }),
    ).rejects.toThrowError(AuthError)
  })

  it('throws 403 when the user is deactivated', async () => {
    const db = makeDb({
      id: 'u1',
      organizationId: 'o1',
      fullName: 'A',
      email: 'a@x.com',
      passwordHash: storedHash,
      role: 'admin',
      status: 'deactivated',
    })
    await expect(
      loginUser(db, { email: 'a@x.com', password: 'correct-horse1!' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('returns the AuthUser (without passwordHash) on success', async () => {
    const db = makeDb({
      id: 'u1',
      organizationId: 'o1',
      fullName: 'Ada',
      email: 'a@x.com',
      passwordHash: storedHash,
      role: 'admin',
      status: 'active',
    })
    const user = await loginUser(db, { email: 'A@X.com', password: 'correct-horse1!' })
    expect(user).toEqual({
      id: 'u1',
      organizationId: 'o1',
      fullName: 'Ada',
      email: 'a@x.com',
      role: 'admin',
      status: 'active',
    })
  })
})
