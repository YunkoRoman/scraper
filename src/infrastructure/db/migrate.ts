// src/infrastructure/db/migrate.ts
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const migrations = ['0001_init.sql', '0002_run_persistence.sql']
  for (const file of migrations) {
    const sql = await readFile(resolve(__dirname, 'migrations', file), 'utf8')
    await pool.query(sql)
    console.log(`Applied: ${file}`)
  }
  await pool.end()
}

migrate().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1) })
