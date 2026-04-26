import { db } from './client.js'
import { parserRuns, runTasks, taskResults } from './schema.js'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

export interface RunInfo {
  id: string
  parserName: string
  status: string
  startedAt: Date
  stoppedAt?: Date | null
  stats: RunStats | null
}

export interface StoredTask {
  id: string
  runId: string
  url: string
  stepName: string
  stepType: 'traverser' | 'extractor'
  state: string
  attempts: number
  maxAttempts: number
  error?: string | null
  parentTaskId?: string | null
  parentData?: Record<string, unknown> | null
}

const MAX_RESUME_TASKS = 10_000

export class RunPersistenceService {
  async createRun(parserName: string, runId: string): Promise<void> {
    await db.insert(parserRuns).values({ id: runId, parserName, status: 'running' })
  }

  async markRunRunning(runId: string): Promise<void> {
    await db.update(parserRuns)
      .set({ status: 'running', stoppedAt: null })
      .where(eq(parserRuns.id, runId))
  }

  async markRunStopped(runId: string, tasks: PageTask[]): Promise<void> {
    await this._bulkUpsertTasks(runId, tasks)
    await db.update(parserRuns)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(parserRuns.id, runId))
  }

  async markRunCompleted(runId: string, tasks: PageTask[]): Promise<void> {
    await this._bulkUpsertTasks(runId, tasks)
    const hasFailed = tasks.some((t) => t.state === PageState.Failed)
    await db.update(parserRuns)
      .set({ status: hasFailed ? 'failed' : 'completed', stoppedAt: new Date() })
      .where(eq(parserRuns.id, runId))
  }

  async upsertTask(runId: string, task: PageTask): Promise<void> {
    await db.insert(runTasks).values({
      id:           task.id,
      runId,
      url:          task.url,
      stepName:     String(task.stepName),
      stepType:     task.stepType,
      state:        task.state,
      attempts:     task.attempts,
      maxAttempts:  task.maxAttempts,
      error:        task.error ?? null,
      parentTaskId: task.parentTaskId ?? null,
      parentData:   task.parentData ?? null,
      updatedAt:    new Date(),
    }).onConflictDoUpdate({
      target: runTasks.id,
      set: {
        state:     sql`excluded.state`,
        attempts:  sql`excluded.attempts`,
        error:     sql`excluded.error`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
  }

  async saveTaskResult(taskId: string, rows: Record<string, unknown>[]): Promise<void> {
    await db.insert(taskResults).values({ taskId, rows })
      .onConflictDoUpdate({ target: taskResults.taskId, set: { rows: sql`excluded.rows` } })
  }

  async getTaskResult(runId: string, taskId: string): Promise<Record<string, unknown>[] | null> {
    const task = await this.getTask(runId, taskId)
    if (!task) return null
    const [row] = await db.select().from(taskResults).where(eq(taskResults.taskId, taskId))
    return row ? (row.rows as Record<string, unknown>[]) : null
  }

  async getTask(runId: string, taskId: string): Promise<StoredTask | null> {
    const [row] = await db.select().from(runTasks)
      .where(and(eq(runTasks.id, taskId), eq(runTasks.runId, runId)))
    return row ? (row as StoredTask) : null
  }

  async getRunById(runId: string): Promise<RunInfo | null> {
    const [row] = await db.select().from(parserRuns).where(eq(parserRuns.id, runId))
    if (!row) return null
    const stats = await this._computeStats(row.id)
    return { ...row, stats }
  }

  async getLatestRunInfo(parserName: string): Promise<RunInfo | null> {
    const [row] = await db.select().from(parserRuns)
      .where(eq(parserRuns.parserName, parserName))
      .orderBy(desc(parserRuns.startedAt))
      .limit(1)
    if (!row) return null
    const stats = await this._computeStats(row.id)
    return { ...row, stats }
  }

  async getAllRuns(page: number, limit: number): Promise<{ runs: (RunInfo & { failedCount: number })[]; total: number }> {
    const offset = (page - 1) * limit
    const rows = await db.select().from(parserRuns)
      .orderBy(desc(parserRuns.startedAt))
      .limit(limit)
      .offset(offset)
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(parserRuns)

    if (rows.length === 0) return { runs: [], total: count }

    const runIds = rows.map((r) => r.id)
    const statsRows = await db.select({
      runId:    runTasks.runId,
      state:    runTasks.state,
      stepType: runTasks.stepType,
      count:    sql<number>`count(*)::int`,
    }).from(runTasks)
      .where(inArray(runTasks.runId, runIds))
      .groupBy(runTasks.runId, runTasks.state, runTasks.stepType)

    const statsByRun = new Map<string, typeof statsRows>()
    for (const row of statsRows) {
      if (!statsByRun.has(row.runId)) statsByRun.set(row.runId, [])
      statsByRun.get(row.runId)!.push(row)
    }

    const runs = rows.map((r) => {
      const runStatRows = statsByRun.get(r.id) ?? []
      const stats = this._computeStatsFromRows(runStatRows)
      return { ...r, stats, failedCount: stats?.failed ?? 0 }
    })
    return { runs, total: count }
  }

  async getRunTasks(
    runId: string,
    page: number,
    limit: number,
    status?: string,
  ): Promise<{ tasks: StoredTask[]; total: number }> {
    const offset = (page - 1) * limit
    const conditions = status
      ? and(eq(runTasks.runId, runId), eq(runTasks.state, status))
      : eq(runTasks.runId, runId)
    const rows = await db.select().from(runTasks)
      .where(conditions)
      .limit(limit)
      .offset(offset)
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(runTasks).where(conditions)
    return { tasks: rows as StoredTask[], total: count }
  }

  async loadLatestStoppedRunTasks(
    parserName: string,
  ): Promise<{ runId: string; tasks: StoredTask[] } | null> {
    const info = await this.getLatestRunInfo(parserName)
    if (!info || info.status !== 'stopped') return null
    const { tasks } = await this.getRunTasks(info.id, 1, MAX_RESUME_TASKS)
    return { runId: info.id, tasks }
  }

  private async _bulkUpsertTasks(runId: string, tasks: PageTask[]): Promise<void> {
    if (tasks.length === 0) return
    for (const task of tasks) {
      await this.upsertTask(runId, task)
    }
  }

  private async _computeStats(runId: string): Promise<RunStats | null> {
    const rows = await db.select({
      runId:    runTasks.runId,
      state:    runTasks.state,
      stepType: runTasks.stepType,
      count:    sql<number>`count(*)::int`,
    }).from(runTasks)
      .where(eq(runTasks.runId, runId))
      .groupBy(runTasks.runId, runTasks.state, runTasks.stepType)
    return this._computeStatsFromRows(rows)
  }

  private _computeStatsFromRows(rows: { state: string; stepType: string; count: number }[]): RunStats | null {
    if (rows.length === 0) return null
    const total     = rows.reduce((s, r) => s + r.count, 0)
    const get       = (state: string) => rows.filter(r => r.state === state).reduce((s, r) => s + r.count, 0)
    const getType   = (type: string, state: string) => rows.find(r => r.stepType === type && r.state === state)?.count ?? 0
    const typeTotal = (type: string) => rows.filter(r => r.stepType === type).reduce((s, r) => s + r.count, 0)
    return {
      total,
      pending:    get('pending'),
      retry:      get('retry'),
      success:    get('success'),
      failed:     get('failed'),
      aborted:    get('aborted'),
      inProgress: get('in_progress'),
      traversers: { total: typeTotal('traverser'), success: getType('traverser', 'success'), failed: getType('traverser', 'failed') },
      extractors: { total: typeTotal('extractor'),  success: getType('extractor',  'success'), failed: getType('extractor',  'failed') },
    }
  }
}
