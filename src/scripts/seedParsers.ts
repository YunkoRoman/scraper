import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import { FileParserLoader } from '../infrastructure/loader/FileParserLoader.js'
import { db, pool } from '../infrastructure/db/client.js'
import { parsers as parsersTable, steps as stepsTable } from '../infrastructure/db/schema.js'
import { eq } from 'drizzle-orm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const parsersDir = resolve(__dirname, '../../src/parsers')

const TRAVERSER_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
const items = await page.$$eval('a', els => els.map(el => el.href))
return items.map(link => ({ link, page_type: 'nextStep', parent_data: {} }))`

const EXTRACTOR_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, __url: task.url }]`

async function seed() {
  const loader = new FileParserLoader(parsersDir)
  const entries = await readdir(parsersDir, { withFileTypes: true })
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  for (const name of names) {
    let config
    try {
      config = await loader.load(name)
    } catch (err) {
      console.warn(`Skipping "${name}":`, (err as Error).message)
      continue
    }

    const existing = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
    if (existing.length) {
      console.log(`  skip (exists): ${name}`)
      continue
    }

    const [parserRow] = await db.insert(parsersTable).values({
      name: config.name,
      entryUrl: config.entryUrl,
      entryStep: String(config.entryStep),
      browserType: config.browserSettings?.browser_type ?? 'playwright',
      browserSettings: config.browserSettings ?? {},
      retryConfig: config.retryConfig,
      deduplication: config.deduplication,
      concurrentQuota: config.concurrentQuota ?? null,
    }).returning()

    let pos = 0
    for (const [stepName, step] of config.steps) {
      await db.insert(stepsTable).values({
        parserId: parserRow.id,
        name: String(stepName),
        type: step.type,
        outputFile: step.type === 'extractor' ? (step as any).outputFile : null,
        code: step.type === 'traverser' ? TRAVERSER_TEMPLATE : EXTRACTOR_TEMPLATE,
        position: pos++,
      })
    }
    console.log(`  seeded: ${name} (${config.steps.size} steps)`)
  }

  await pool.end()
  console.log('Seed complete')
}

seed().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1) })
