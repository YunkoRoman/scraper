import { hashPassword } from '../../infrastructure/auth/hashPassword.js'
import { AuthError } from './AuthError.js'
import type { AuthUser } from './AuthUser.js'

export interface RegisterInput {
  organizationName: string
  industry: string
  fullName: string
  email: string
  password: string
}

export interface CreateOrgAndUserArgs {
  orgName: string
  industry: string
  fullName: string
  email: string
  passwordHash: string
  role: 'admin' | 'coworker'
  status: 'active' | 'pending' | 'deactivated'
}

/** Narrow DB port the auth use cases depend on. */
export interface AuthDb {
  findUserByEmail(email: string): Promise<{
    id: string
    organizationId: string
    fullName: string
    email: string
    passwordHash: string
    role: 'admin' | 'coworker'
    status: 'active' | 'pending' | 'deactivated'
  } | null>
  createOrgAndUser(args: CreateOrgAndUserArgs): Promise<AuthUser>
}

const MIN_LENGTH = 12

export function validatePassword(password: string): void {
  if (password.length < MIN_LENGTH) {
    throw new AuthError(400, 'Password must be at least 12 characters')
  }
  if (!/[0-9]/.test(password)) {
    throw new AuthError(400, 'Password must contain at least one number')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new AuthError(400, 'Password must contain at least one symbol')
  }
}

export async function registerOrganization(db: AuthDb, input: RegisterInput): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase()
  validatePassword(input.password)

  const existing = await db.findUserByEmail(email)
  if (existing) {
    throw new AuthError(409, 'Email already registered')
  }

  const passwordHash = await hashPassword(input.password)

  const raw = await db.createOrgAndUser({
    orgName: input.organizationName.trim(),
    industry: input.industry,
    fullName: input.fullName.trim(),
    email,
    passwordHash,
    role: 'admin',
    status: 'active',
  })

  return {
    id: raw.id,
    organizationId: raw.organizationId,
    fullName: raw.fullName,
    email: raw.email,
    role: raw.role,
    status: raw.status,
  }
}
