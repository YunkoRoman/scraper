import { AuthError } from './AuthError.js'
import type { AuthUser } from './AuthUser.js'
import type { AuthDb } from './RegisterOrganization.js'

export interface LoginInput {
  email: string
  password: string
}

export async function loginUser(db: AuthDb, input: LoginInput): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase()
  const record = await db.findUserByEmail(email)
  if (!record) {
    throw new AuthError(401, 'Invalid email or password')
  }

  // Check status BEFORE running bcrypt (avoids timing side-channel, blocks pending users)
  if (record.status !== 'active') {
    throw new AuthError(403, 'Account is not active')
  }

  const ok = await db.comparePassword(input.password, record.passwordHash)
  if (!ok) {
    throw new AuthError(401, 'Invalid email or password')
  }

  return {
    id: record.id,
    organizationId: record.organizationId,
    fullName: record.fullName,
    email: record.email,
    role: record.role,
    status: record.status,
  }
}
