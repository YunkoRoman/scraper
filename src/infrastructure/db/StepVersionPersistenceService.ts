import { eq, desc, isNotNull, and } from 'drizzle-orm'
import { stepVersions } from './schema.js'
import { BasePersistenceService } from './BasePersistenceService.js'

export type StepVersionRow = typeof stepVersions.$inferSelect

export interface CreateVersionInput {
  stepId: string
  code: string
}
export interface UpdateVersionInput {
  code?: string
}

export class StepVersionPersistenceService extends BasePersistenceService<
  StepVersionRow,
  CreateVersionInput,
  UpdateVersionInput
> {
  async create(input: CreateVersionInput): Promise<StepVersionRow> {
    const [row] = await this.db
      .insert(stepVersions)
      .values({ stepId: input.stepId, code: input.code })
      .returning()
    return row
  }

  async findById(id: string): Promise<StepVersionRow | null> {
    const [row] = await this.db.select().from(stepVersions).where(eq(stepVersions.id, id))
    return row ?? null
  }

  async update(_id: string, _input: UpdateVersionInput): Promise<StepVersionRow> {
    throw new Error('Version records are immutable')
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(stepVersions).where(eq(stepVersions.id, id))
  }

  async save(stepId: string, code: string): Promise<StepVersionRow> {
    return this.create({ stepId, code })
  }

  async createMajor(stepId: string, code: string): Promise<StepVersionRow | null> {
    const [latest] = await this.db
      .select({ versionNumber: stepVersions.versionNumber, code: stepVersions.code })
      .from(stepVersions)
      .where(and(eq(stepVersions.stepId, stepId), isNotNull(stepVersions.versionNumber)))
      .orderBy(desc(stepVersions.versionNumber))
      .limit(1)
    if (latest && latest.code === code) return null
    const nextNum = (latest?.versionNumber ?? 0) + 1
    const [row] = await this.db
      .insert(stepVersions)
      .values({ stepId, code, versionNumber: nextNum })
      .returning()
    return row
  }

  async list(stepId: string, limit = 50): Promise<StepVersionRow[]> {
    return this.db
      .select()
      .from(stepVersions)
      .where(eq(stepVersions.stepId, stepId))
      .orderBy(desc(stepVersions.savedAt))
      .limit(limit)
  }
}
