// src/infrastructure/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import * as schema from './schema.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: intFromEnv('DB_POOL_MAX', 50),
  min: intFromEnv('DB_POOL_MIN', 2),
  idleTimeoutMillis: intFromEnv('DB_POOL_IDLE_MS', 30_000),
  connectionTimeoutMillis: intFromEnv('DB_POOL_CONNECT_TIMEOUT_MS', 10_000),
}

const pool = new Pool(poolConfig)
pool.on('error', (err) => console.error('DB pool error:', err))

export const db = drizzle(pool, { schema })
export { pool }

/** Closes the pool gracefully. Idempotent. */
let ended = false
export async function closePool(): Promise<void> {
  if (ended) return
  ended = true
  await pool.end()
}
