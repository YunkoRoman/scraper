import jwt from 'jsonwebtoken'

export interface JwtPayload {
  userId: string
  orgId: string
  role: 'admin' | 'coworker'
}

const EXPIRES_IN = '7d'

function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET environment variable is required')
  return s
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: EXPIRES_IN })
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, secret()) as JwtPayload & { iat: number; exp: number }
  return { userId: decoded.userId, orgId: decoded.orgId, role: decoded.role }
}
