// src/infrastructure/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/scraper',
})

pool.on('error', (err) => console.error('DB pool error:', err))

export const db = drizzle(pool, { schema })
export { pool }
