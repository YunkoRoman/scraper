// src/infrastructure/db/migrate.ts
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const migrations = [
    '0001_init.sql',
    '0002_run_persistence.sql',
    '0003_task_html.sql',
    '0004_scheduled_runs.sql',
    '0004b_scheduled_runs_unique.sql',
    '0005_webhook_url.sql',
    '0006_step_versions.sql',
    '0007_auth.sql',
    '0008_org_isolation.sql',
  ]
  for (const file of migrations) {
    const sql = await readFile(resolve(__dirname, 'migrations', file), 'utf8')
    await pool.query(sql)
    console.log(`Applied: ${file}`)
  }
  await pool.end()
}

migrate().catch(async (err) => {
  console.error(err)
  await pool.end().catch(() => {})
  process.exit(1)
})
