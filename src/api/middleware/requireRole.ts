import type { Request, Response, NextFunction } from 'express'

/** Factory: returns middleware that 403s unless req.user.role matches. */
export function requireRole(role: 'admin' | 'coworker') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}
