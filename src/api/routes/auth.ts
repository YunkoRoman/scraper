import { Router } from 'express'
import { db, pool } from '../../infrastructure/db/client.js'
import { users } from '../../infrastructure/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { registerOrganization, type AuthDb } from '../../application/auth/RegisterOrganization.js'
import { loginUser } from '../../application/auth/LoginUser.js'
import { AuthError } from '../../application/auth/AuthError.js'
import type { AuthUser } from '../../application/auth/AuthUser.js'
import { signToken } from '../../infrastructure/auth/jwtService.js'
import { hashPassword, comparePassword } from '../../infrastructure/auth/hashPassword.js'
import { AUTH_COOKIE } from '../middleware/authenticate.js'
import type { CookieOptions } from 'express'

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

const authDb: AuthDb = {
  async findUserByEmail(email) {
    const rows = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = ${email.toLowerCase()}`)
      .limit(1)
    const r = rows[0]
    if (!r) return null
    return {
      id: r.id,
      organizationId: r.organizationId,
      fullName: r.fullName,
      email: r.email,
      passwordHash: r.passwordHash,
      role: r.role as 'admin' | 'coworker',
      status: r.status as 'active' | 'pending' | 'deactivated',
    }
  },

  async createOrgAndUser(args) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const org = await client.query(
        `INSERT INTO organizations (name, industry) VALUES ($1, $2) RETURNING id`,
        [args.orgName, args.industry],
      )
      const orgId = org.rows[0].id as string
      const user = await client.query(
        `INSERT INTO users (organization_id, full_name, email, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, full_name, email, role, status`,
        [orgId, args.fullName, args.email, args.passwordHash, args.role, args.status],
      )
      await client.query('COMMIT')
      const u = user.rows[0]
      return {
        id: u.id,
        organizationId: u.organization_id,
        fullName: u.full_name,
        email: u.email,
        role: u.role,
        status: u.status,
      }
    } catch (err) {
      await client.query('ROLLBACK')
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        throw new AuthError(409, 'Organization name or email already in use')
      }
      throw err
    } finally {
      client.release()
    }
  },

  hashPassword: (plain) => hashPassword(plain),
  comparePassword: (plain, hash) => comparePassword(plain, hash),
}

function issueCookie(res: import('express').Response, user: AuthUser): void {
  const token = signToken({ userId: user.id, orgId: user.organizationId, role: user.role })
  res.cookie(AUTH_COOKIE, token, COOKIE_OPTIONS)
}

export function createAuthRouter() {
  const router = Router()

  router.post('/register', async (req, res) => {
    try {
      const user = await registerOrganization(authDb, req.body)
      issueCookie(res, user)
      res.status(201).json({ user })
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message })
        return
      }
      console.error('[auth/register]', err)
      res.status(500).json({ error: 'Registration failed' })
    }
  })

  router.post('/login', async (req, res) => {
    try {
      const user = await loginUser(authDb, req.body)
      issueCookie(res, user)
      res.json({ user })
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message })
        return
      }
      console.error('[auth/login]', err)
      res.status(500).json({ error: 'Login failed' })
    }
  })

  router.post('/logout', (_req, res) => {
    res.clearCookie(AUTH_COOKIE, { ...COOKIE_OPTIONS, maxAge: undefined })
    res.json({ ok: true })
  })

  router.get('/me', async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    const rows = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1)
    const r = rows[0]
    if (!r) {
      res.status(401).json({ error: 'User no longer exists' })
      return
    }
    const user: AuthUser = {
      id: r.id,
      organizationId: r.organizationId,
      fullName: r.fullName,
      email: r.email,
      role: r.role as 'admin' | 'coworker',
      status: r.status as 'active' | 'pending' | 'deactivated',
    }
    res.json({ user })
  })

  return router
}
