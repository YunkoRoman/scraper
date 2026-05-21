import { eq } from 'drizzle-orm'
import { scheduledRuns } from './schema.js'
import { BasePersistenceService } from './BasePersistenceService.js'

export type ScheduleRow = typeof scheduledRuns.$inferSelect

export interface UpsertScheduleInput {
  parserId:       string
  cronExpression: string
  enabled:        boolean
  nextRunAt?:     Date | null
}

export interface UpdateScheduleInput {
  cronExpression?: string
  enabled?:        boolean
  nextRunAt?:      Date | null
  lastRunAt?:      Date | null
}

export class SchedulePersistenceService extends BasePersistenceService<ScheduleRow, UpsertScheduleInput, UpdateScheduleInput> {

  async create(input: UpsertScheduleInput): Promise<ScheduleRow> {
    const [row] = await this.db.insert(scheduledRuns).values({
      parserId:       input.parserId,
      cronExpression: input.cronExpression,
      enabled:        input.enabled,
      nextRunAt:      input.nextRunAt ?? null,
    }).returning()
    return row
  }

  async findById(id: string): Promise<ScheduleRow | null> {
    const [row] = await this.db.select().from(scheduledRuns).where(eq(scheduledRuns.id, id))
    return row ?? null
  }

  async update(id: string, input: UpdateScheduleInput): Promise<ScheduleRow> {
    const [row] = await this.db.update(scheduledRuns).set({
      ...(input.cronExpression !== undefined && { cronExpression: input.cronExpression }),
      ...(input.enabled        !== undefined && { enabled:        input.enabled }),
      ...(input.nextRunAt      !== undefined && { nextRunAt:      input.nextRunAt }),
      ...(input.lastRunAt      !== undefined && { lastRunAt:      input.lastRunAt }),
    }).where(eq(scheduledRuns.id, id)).returning()
    return row
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(scheduledRuns).where(eq(scheduledRuns.id, id))
  }

  async findByParserId(parserId: string): Promise<ScheduleRow | null> {
    const [row] = await this.db.select().from(scheduledRuns).where(eq(scheduledRuns.parserId, parserId))
    return row ?? null
  }

  async upsertForParser(input: UpsertScheduleInput): Promise<ScheduleRow> {
    const existing = await this.findByParserId(input.parserId)
    if (existing) {
      return this.update(existing.id, {
        cronExpression: input.cronExpression,
        enabled:        input.enabled,
        nextRunAt:      input.nextRunAt ?? null,
      })
    }
    return this.create(input)
  }

  async deleteByParserId(parserId: string): Promise<void> {
    await this.db.delete(scheduledRuns).where(eq(scheduledRuns.parserId, parserId))
  }

  async listEnabled(): Promise<ScheduleRow[]> {
    return this.db.select().from(scheduledRuns).where(eq(scheduledRuns.enabled, true))
  }
}
