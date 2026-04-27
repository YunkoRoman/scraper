import { parsers as parsersTable, steps as stepsTable } from './schema.js'
import { eq, and } from 'drizzle-orm'
import { BasePersistenceService } from './BasePersistenceService.js'

export type ParserRow = typeof parsersTable.$inferSelect
export type StepRow   = typeof stepsTable.$inferSelect
export type StepSummary = Pick<StepRow, 'name' | 'type' | 'position'>

export class ParserAlreadyExistsError extends Error {}
export class StepAlreadyExistsError   extends Error {}

export interface CreateParserInput {
  name: string
  entryUrl?: string
  entryStep?: string
  browserType?: string
  browserSettings?: object
  retryConfig?: { maxRetries: number }
  deduplication?: boolean
  concurrentQuota?: number | null
}

export interface UpdateParserInput {
  entryUrl?: string
  entryStep?: string
  browserType?: string
  browserSettings?: object
  retryConfig?: { maxRetries: number }
  deduplication?: boolean
  concurrentQuota?: number | null
}

export interface CreateStepInput {
  parserId: string
  name: string
  type: 'traverser' | 'extractor'
  entryUrl?: string
  outputFile?: string | null
  code?: string
  position?: number
}

export interface UpdateStepInput {
  name?: string
  type?: string
  entryUrl?: string
  outputFile?: string
  code?: string
  stepSettings?: object
  position?: number
}

export class ParserPersistenceService extends BasePersistenceService<ParserRow, CreateParserInput, UpdateParserInput> {

  // ── Abstract implementations ─────────────────────────────────────────────

  async create(input: CreateParserInput): Promise<ParserRow> {
    try {
      const [row] = await this.db.insert(parsersTable).values({
        name:            input.name,
        entryUrl:        input.entryUrl        ?? '',
        entryStep:       input.entryStep       ?? '',
        browserType:     input.browserType     ?? 'playwright',
        browserSettings: input.browserSettings ?? {},
        retryConfig:     input.retryConfig     ?? { maxRetries: 5 },
        deduplication:   input.deduplication   ?? true,
        concurrentQuota: input.concurrentQuota ?? null,
      }).returning()
      return row
    } catch (err) {
      if (this.isDuplicateKeyError(err)) throw new ParserAlreadyExistsError(`Parser "${input.name}" already exists`)
      throw err
    }
  }

  async findById(id: string): Promise<ParserRow | null> {
    const [row] = await this.db.select().from(parsersTable).where(eq(parsersTable.id, id))
    return row ?? null
  }

  async update(id: string, input: UpdateParserInput): Promise<ParserRow> {
    const [updated] = await this.db.update(parsersTable).set({
      ...(input.entryUrl        !== undefined && { entryUrl:        input.entryUrl }),
      ...(input.entryStep       !== undefined && { entryStep:       input.entryStep }),
      ...(input.browserType     !== undefined && { browserType:     input.browserType }),
      ...(input.browserSettings !== undefined && { browserSettings: input.browserSettings }),
      ...(input.retryConfig     !== undefined && { retryConfig:     input.retryConfig }),
      ...(input.deduplication   !== undefined && { deduplication:   input.deduplication }),
      ...(input.concurrentQuota !== undefined && { concurrentQuota: input.concurrentQuota }),
      updatedAt: new Date(),
    }).where(eq(parsersTable.id, id)).returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(parsersTable).where(eq(parsersTable.id, id))
  }

  // ── Parser queries ────────────────────────────────────────────────────────

  async listParserNames(): Promise<string[]> {
    const rows = await this.db.select({ name: parsersTable.name }).from(parsersTable)
    return rows.map((r) => r.name)
  }

  async getParserByName(name: string): Promise<ParserRow | null> {
    const [row] = await this.db.select().from(parsersTable).where(eq(parsersTable.name, name))
    return row ?? null
  }

  async getParserWithSteps(name: string): Promise<{ parser: ParserRow; steps: StepRow[] } | null> {
    const parser = await this.getParserByName(name)
    if (!parser) return null
    const steps = await this.db.select().from(stepsTable)
      .where(eq(stepsTable.parserId, parser.id))
      .orderBy(stepsTable.position)
    return { parser, steps }
  }

  // ── Steps CRUD ────────────────────────────────────────────────────────────

  async listSteps(parserId: string): Promise<StepSummary[]> {
    return this.db.select({
      name:     stepsTable.name,
      type:     stepsTable.type,
      position: stepsTable.position,
    }).from(stepsTable).where(eq(stepsTable.parserId, parserId)).orderBy(stepsTable.position)
  }

  async getStep(parserId: string, stepName: string): Promise<StepRow | null> {
    const [row] = await this.db.select().from(stepsTable)
      .where(and(eq(stepsTable.parserId, parserId), eq(stepsTable.name, stepName)))
    return row ?? null
  }

  async createStep(input: CreateStepInput): Promise<StepRow> {
    try {
      const [row] = await this.db.insert(stepsTable).values({
        parserId:   input.parserId,
        name:       input.name,
        type:       input.type,
        entryUrl:   input.entryUrl   ?? '',
        outputFile: input.outputFile ?? (input.type === 'extractor' ? `${input.name}.csv` : null),
        code:       input.code       ?? '',
        position:   input.position   ?? 0,
      }).returning()
      return row
    } catch (err) {
      if (this.isDuplicateKeyError(err)) throw new StepAlreadyExistsError(`Step "${input.name}" already exists`)
      throw err
    }
  }

  async updateStep(stepId: string, input: UpdateStepInput): Promise<StepRow> {
    try {
      const [updated] = await this.db.update(stepsTable).set({
        ...(input.name         !== undefined && { name:         input.name }),
        ...(input.type         !== undefined && { type:         input.type }),
        ...(input.entryUrl     !== undefined && { entryUrl:     input.entryUrl }),
        ...(input.outputFile   !== undefined && { outputFile:   input.outputFile }),
        ...(input.code         !== undefined && { code:         input.code }),
        ...(input.stepSettings !== undefined && { stepSettings: input.stepSettings }),
        ...(input.position     !== undefined && { position:     input.position }),
        updatedAt: new Date(),
      }).where(eq(stepsTable.id, stepId)).returning()
      return updated
    } catch (err) {
      if (this.isDuplicateKeyError(err)) throw new StepAlreadyExistsError('Step name already exists')
      throw err
    }
  }

  async deleteStep(parserId: string, stepName: string): Promise<boolean> {
    const deleted = await this.db.delete(stepsTable)
      .where(and(eq(stepsTable.parserId, parserId), eq(stepsTable.name, stepName)))
      .returning({ id: stepsTable.id })
    return deleted.length > 0
  }
}
