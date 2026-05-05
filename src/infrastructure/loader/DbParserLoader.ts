import type { IParserLoader } from './IParserLoader.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import { Traverser } from '../../domain/entities/Traverser.js'
import { Extractor } from '../../domain/entities/Extractor.js'
import { stepName } from '../../domain/value-objects/StepName.js'
import { DEFAULT_RETRY_CONFIG } from '../../domain/value-objects/RetryConfig.js'
import { db } from '../db/client.js'
import { parsers, steps as stepsTable } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: any[]) => Promise<any>

export class DbParserLoader implements IParserLoader {
  async load(parserName: string): Promise<ParserConfig> {
    const parserRows = await db.select().from(parsers).where(eq(parsers.name, parserName))
    const row = parserRows[0]
    if (!row) throw new Error(`Parser "${parserName}" not found`)

    const stepRows = await db.select().from(stepsTable)
      .where(eq(stepsTable.parserId, row.id))
      .orderBy(stepsTable.position)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepMap = new Map<any, any>()
    for (const s of stepRows) {
      const sn = stepName(s.name)
      const settings = Object.keys(s.stepSettings as object).length ? (s.stepSettings as StepSettings) : undefined
      let run: (...a: unknown[]) => Promise<unknown>
      try {
        run = new AsyncFunction('page', 'task', s.code)
      } catch (err) {
        throw new Error(`Syntax error in step "${s.name}" of parser "${row.name}": ${(err as Error).message}`)
      }
      if (s.type === 'traverser') {
        const t = new Traverser(sn, run as (page: unknown, task: PageTask) => Promise<TraverserResult[]>, settings)
        t.code = s.code
        stepMap.set(sn, t)
      } else {
        const e = new Extractor(
          sn,
          run as (page: unknown, task: PageTask) => Promise<Record<string, unknown>[]>,
          s.outputFile ?? `${s.name}.csv`,
          settings,
        )
        e.code = s.code
        stepMap.set(sn, e)
      }
    }

    return {
      name: row.name,
      entryUrl: row.entryUrl,
      entryStep: stepName(row.entryStep || stepRows[0]?.name || ''),
      steps: stepMap,
      retryConfig: { ...DEFAULT_RETRY_CONFIG, ...(row.retryConfig as object) },
      deduplication: row.deduplication,
      concurrentQuota: row.concurrentQuota ?? undefined,
      browserSettings: Object.keys(row.browserSettings as object).length
        ? (row.browserSettings as ParserConfig['browserSettings'])
        : undefined,
    }
  }
}
