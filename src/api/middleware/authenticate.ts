import type { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../../infrastructure/auth/jwtService.js'
import type { AuthUser } from '../../application/auth/AuthUser.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export const AUTH_COOKIE = 'auth_token'

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE]
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  try {
    const payload = verifyToken(token)
    req.user = {
      id: payload.userId,
      organizationId: payload.orgId,
      role: payload.role,
      fullName: '',
      email: '',
      status: 'active',
    }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' })
  }
}
