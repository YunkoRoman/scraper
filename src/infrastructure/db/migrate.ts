// src/infrastructure/db/migrate.ts
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const sql = await readFile(resolve(__dirname, 'migrations/0001_init.sql'), 'utf8')
  await pool.query(sql)
  console.log('Migration complete')
  await pool.end()
}

migrate().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1) })
