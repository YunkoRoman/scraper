import { describe, it, expect, vi } from 'vitest'
import {
  registerOrganization,
  type AuthDb,
} from '../../src/application/auth/RegisterOrganization.js'
import { AuthError } from '../../src/application/auth/AuthError.js'

function makeDb(overrides: Partial<AuthDb> = {}): AuthDb {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
    createOrgAndUser: vi.fn().mockResolvedValue({
      id: 'user-1',
      organizationId: 'org-1',
      fullName: 'Ada Admin',
      email: 'ada@acme.com',
      role: 'admin' as const,
      status: 'active' as const,
    }),
    ...overrides,
  }
}

const validInput = {
  organizationName: 'Acme',
  industry: 'Technology',
  fullName: 'Ada Admin',
  email: 'ada@acme.com',
  password: 'longenough1!',
}

describe('registerOrganization', () => {
  it('rejects a password shorter than 12 characters', async () => {
    const db = makeDb()
    await expect(
      registerOrganization(db, { ...validInput, password: 'short1!' }),
    ).rejects.toThrowError(AuthError)
  })

  it('rejects a password with no number', async () => {
    const db = makeDb()
    await expect(
      registerOrganization(db, { ...validInput, password: 'nonumbershere!' }),
    ).rejects.toThrowError(AuthError)
  })

  it('rejects a password with no symbol', async () => {
    const db = makeDb()
    await expect(
      registerOrganization(db, { ...validInput, password: 'nosymbolhere1' }),
    ).rejects.toThrowError(AuthError)
  })

  it('throws a 409 AuthError when the email already exists', async () => {
    const db = makeDb({
      findUserByEmail: vi.fn().mockResolvedValue({ id: 'existing' }),
    })
    await expect(registerOrganization(db, validInput)).rejects.toMatchObject({ status: 409 })
  })

  it('hashes the password via db.hashPassword before persisting', async () => {
    const db = makeDb()
    await registerOrganization(db, validInput)
    expect(db.hashPassword).toHaveBeenCalledWith(validInput.password)
    const arg = (db.createOrgAndUser as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.passwordHash).toBe('hashed-password')
    expect(arg.passwordHash).not.toBe(validInput.password)
  })

  it('returns an AuthUser with role=admin and status=active', async () => {
    const db = makeDb()
    const user = await registerOrganization(db, validInput)
    expect(user).toEqual({
      id: 'user-1',
      organizationId: 'org-1',
      fullName: 'Ada Admin',
      email: 'ada@acme.com',
      role: 'admin',
      status: 'active',
    })
  })
})
