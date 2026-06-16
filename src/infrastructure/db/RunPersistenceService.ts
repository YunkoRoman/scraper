import { parserRuns, runTasks, taskResults, parsers } from './schema.js'
import { eq, and, desc, sql, inArray, type SQL } from 'drizzle-orm'
import { BasePersistenceService } from './BasePersistenceService.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'
import { TaskWriteBuffer, type TaskSink } from './TaskWriteBuffer.js'

export interface ParserStats {
  totalRuns: number
  successRate: number | null
  avgDurationSeconds: number | null
}

export interface RawParserEnriched {
  id: string
  name: string
  dbStatus: 'running' | 'stopped' | 'idle'
  lastRunDate: string | null
  lastRunId: string | null
  /** Percentage of tasks with state='success' in the latest run. Null if no runs. */
  successRate: number | null
}

export interface RunInfo {
  id: string
  parserName: string
  browserType: string
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
  parent_data?: Record<string, unknown> | null
  itemCount: number | null
}

export interface CreateRunInput {
  parserName: string
  runId: string
}

export interface UpdateRunStatusInput {
  status: 'running' | 'stopped' | 'completed' | 'failed'
  stoppedAt?: Date | null
}

const MAX_RESUME_TASKS = 10_000

export class RunPersistenceService extends BasePersistenceService<
  RunInfo,
  CreateRunInput,
  UpdateRunStatusInput
> {
  private readonly writeBuffer: TaskWriteBuffer = new TaskWriteBuffer(this.makeSink())

  private makeSink(): TaskSink {
    return {
      flushTaskBatch: async (batch) => {
        for (const { runId, tasks } of batch) {
          await this._bulkUpsertTasks(runId, tasks)
        }
      },
      flushResultBatch: async (batch) => {
        await this._bulkSaveResults(batch)
      },
    }
  }

  async flushPendingWrites(): Promise<void> {
    await this.writeBuffer.flush()
  }

  // ── Abstract implementations ─────────────────────────────────────────────

  async create(input: CreateRunInput): Promise<RunInfo> {
    await this.db
      .insert(parserRuns)
      .values({ id: input.runId, parserName: input.parserName, status: 'running' })
    return {
      id: input.runId,
      parserName: input.parserName,
      browserType: 'playwright',
      status: 'running',
      startedAt: new Date(),
      stats: null,
    }
  }

  async findById(id: string): Promise<RunInfo | null> {
    const [row] = await this.db
      .select({ run: parserRuns, browserType: parsers.browserType })
      .from(parserRuns)
      .leftJoin(parsers, eq(parsers.name, parserRuns.parserName))
      .where(eq(parserRuns.id, id))
    if (!row) return null
    const stats = await this._computeStats(row.run.id)
    return { ...row.run, browserType: row.browserType ?? 'playwright', stats }
  }

  async update(id: string, input: UpdateRunStatusInput): Promise<RunInfo> {
    await this.db
      .update(parserRuns)
      .set({
        status: input.status,
        ...(input.stoppedAt !== undefined && { stoppedAt: input.stoppedAt }),
      })
      .where(eq(parserRuns.id, id))
    const [row] = await this.db.select().from(parserRuns).where(eq(parserRuns.id, id))
    return { ...row, browserType: 'playwright', stats: null }
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(parserRuns).where(eq(parserRuns.id, id))
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────

  async markRunRunning(runId: string): Promise<void> {
    await this.update(runId, { status: 'running', stoppedAt: null })
  }

  async markRunStopped(runId: string, tasks: PageTask[]): Promise<void> {
    await this.flushPendingWrites()
    await this._bulkUpsertTasks(runId, tasks)
    await this.update(runId, { status: 'stopped', stoppedAt: new Date() })
  }

  async markRunCompleted(runId: string, tasks: PageTask[]): Promise<void> {
    await this.flushPendingWrites()
    await this._bulkUpsertTasks(runId, tasks)
    const hasFailed = tasks.some((t) => t.state === 'failed')
    const finalStatus = hasFailed ? 'failed' : 'completed'
    console.log(
      `[RunPersistenceService] markRunCompleted runId=${runId} tasks=${tasks.length} hasFailed=${hasFailed} → ${finalStatus}`,
    )
    await this.update(runId, { status: finalStatus, stoppedAt: new Date() })
  }

  // ── Task persistence ──────────────────────────────────────────────────────

  async upsertTask(runId: string, task: PageTask): Promise<void> {
    this.writeBuffer.enqueueTask(runId, task)
  }

  async saveTaskResult(taskId: string, rows: Record<string, unknown>[]): Promise<void> {
    this.writeBuffer.enqueueResult(taskId, rows)
  }

  async saveTaskHtml(taskId: string, html: string): Promise<void> {
    await this.db
      .insert(taskResults)
      .values({ taskId, rows: [], html })
      .onConflictDoUpdate({ target: taskResults.taskId, set: { html: sql`excluded.html` } })
  }

  async getTaskResult(
    runId: string,
    taskId: string,
  ): Promise<{ rows: Record<string, unknown>[]; html: string | null } | null> {
    const task = await this.getTask(runId, taskId)
    if (!task) return null
    const [row] = await this.db.select().from(taskResults).where(eq(taskResults.taskId, taskId))
    if (!row) return null
    return { rows: row.rows as Record<string, unknown>[], html: row.html ?? null }
  }

  async getTask(runId: string, taskId: string): Promise<StoredTask | null> {
    const buffered = this.writeBuffer.peekTask(taskId)
    if (buffered) {
      return {
        id: buffered.id,
        runId,
        url: buffered.url,
        stepName: String(buffered.stepName),
        stepType: buffered.stepType,
        state: buffered.state,
        attempts: buffered.attempts,
        maxAttempts: buffered.maxAttempts,
        error: buffered.error ?? null,
        parentTaskId: buffered.parentTaskId ?? null,
        parent_data: buffered.parent_data ?? null,
        itemCount: null,
      }
    }
    const [row] = await this.db
      .select()
      .from(runTasks)
      .where(and(eq(runTasks.id, taskId), eq(runTasks.runId, runId)))
    return row ? (row as unknown as StoredTask) : null
  }

  // ── Run queries ───────────────────────────────────────────────────────────

  async getLatestRunInfo(parserName: string): Promise<RunInfo | null> {
    const [row] = await this.db
      .select({ run: parserRuns, browserType: parsers.browserType })
      .from(parserRuns)
      .leftJoin(parsers, eq(parsers.name, parserRuns.parserName))
      .where(eq(parserRuns.parserName, parserName))
      .orderBy(desc(parserRuns.startedAt))
      .limit(1)
    if (!row) return null
    const stats = await this._computeStats(row.run.id)
    return { ...row.run, browserType: row.browserType ?? 'playwright', stats }
  }

  async getAllRuns(
    page: number,
    limit: number,
    options?: { parserName?: string },
  ): Promise<{ runs: (RunInfo & { failedCount: number })[]; total: number }> {
    const offset = (page - 1) * limit
    const filter = options?.parserName ? eq(parserRuns.parserName, options.parserName) : undefined
    const rows = await this.db
      .select()
      .from(parserRuns)
      .where(filter)
      .orderBy(desc(parserRuns.startedAt))
      .limit(limit)
      .offset(offset)
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(parserRuns)
      .where(filter)

    if (rows.length === 0) return { runs: [], total: count }

    const runIds = rows.map((r) => r.id)
    const statsRows = await this.db
      .select({
        runId: runTasks.runId,
        state: runTasks.state,
        stepType: runTasks.stepType,
        count: sql<number>`count(*)::int`,
      })
      .from(runTasks)
      .where(inArray(runTasks.runId, runIds))
      .groupBy(runTasks.runId, runTasks.state, runTasks.stepType)

    const statsByRun = new Map<string, typeof statsRows>()
    for (const row of statsRows) {
      if (!statsByRun.has(row.runId)) statsByRun.set(row.runId, [])
      statsByRun.get(row.runId)!.push(row)
    }

    const parserNames = [...new Set(rows.map((r) => r.parserName))]
    const parserRows = await this.db
      .select({ name: parsers.name, browserType: parsers.browserType })
      .from(parsers)
      .where(inArray(parsers.name, parserNames))
    const browserTypeByParser = new Map(parserRows.map((p) => [p.name, p.browserType]))

    const runs = rows.map((r) => {
      const runStatRows = statsByRun.get(r.id) ?? []
      const stats = this._computeStatsFromRows(runStatRows)
      return {
        ...r,
        browserType: browserTypeByParser.get(r.parserName) ?? 'playwright',
        stats,
        failedCount: stats?.failed ?? 0,
      }
    })
    return { runs, total: count }
  }

  async getRunTasks(
    runId: string,
    page: number,
    limit: number,
    status?: string,
    stepName?: string,
  ): Promise<{ tasks: StoredTask[]; total: number }> {
    const offset = (page - 1) * limit
    const clauses: SQL[] = [eq(runTasks.runId, runId)]
    if (status) clauses.push(eq(runTasks.state, status))
    if (stepName) clauses.push(eq(runTasks.stepName, stepName))
    const conditions = and(...clauses)
    const rows = await this.db.select().from(runTasks).where(conditions).limit(limit).offset(offset)
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(runTasks)
      .where(conditions)
    return { tasks: rows as unknown as StoredTask[], total: count }
  }

  async getStepStats(
    runId: string,
  ): Promise<{ stepName: string; total: number; success: number; failed: number }[]> {
    return this.db
      .select({
        stepName: runTasks.stepName,
        total: sql<number>`count(*)::int`,
        success: sql<number>`count(*) filter (where state = 'success')::int`,
        failed: sql<number>`count(*) filter (where state = 'failed')::int`,
      })
      .from(runTasks)
      .where(eq(runTasks.runId, runId))
      .groupBy(runTasks.stepName)
  }

  async getTaskItemCounts(
    taskIds: string[],
    stepTypes: Map<string, 'traverser' | 'extractor'>,
  ): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map()
    const result = new Map<string, number>()

    const extractorIds = taskIds.filter((id) => stepTypes.get(id) === 'extractor')
    if (extractorIds.length > 0) {
      const rows = await this.db.execute<{ task_id: string; cnt: number }>(sql`
        SELECT task_id, COALESCE(jsonb_array_length(rows), 0) AS cnt
        FROM task_results
        WHERE task_id = ANY(${extractorIds}::uuid[])
      `)
      for (const r of rows.rows) result.set(r.task_id, r.cnt)
    }

    const traverserIds = taskIds.filter((id) => stepTypes.get(id) === 'traverser')
    if (traverserIds.length > 0) {
      const rows = await this.db.execute<{ parent_task_id: string; cnt: number }>(sql`
        SELECT parent_task_id, COUNT(*)::int AS cnt
        FROM run_tasks
        WHERE parent_task_id = ANY(${traverserIds}::uuid[])
        GROUP BY parent_task_id
      `)
      for (const r of rows.rows) result.set(r.parent_task_id, r.cnt)
    }

    return result
  }

  async loadLatestStoppedRunTasks(
    parserName: string,
  ): Promise<{ runId: string; tasks: StoredTask[] } | null> {
    const info = await this.getLatestRunInfo(parserName)
    if (!info || info.status !== 'stopped') return null
    const { tasks } = await this.getRunTasks(info.id, 1, MAX_RESUME_TASKS)
    return { runId: info.id, tasks }
  }

  async resetFailedTasks(runId: string): Promise<void> {
    await this.db
      .update(runTasks)
      .set({ state: 'pending', error: null, attempts: 0, updatedAt: new Date() })
      .where(and(eq(runTasks.runId, runId), eq(runTasks.state, 'failed')))
  }

  async listParsersWithLatestRun(search: string, orgId: string): Promise<RawParserEnriched[]> {
    const escaped = (search ?? '').replace(/[%_\\]/g, '\\$&')
    const pattern = `%${escaped}%`

    type Row = {
      parser_id: string
      name: string
      run_id: string | null
      run_status: string | null
      started_at: Date | null
      success_count: number
      total_count: number
    }

    const result = await this.db.execute<Row>(sql`
      WITH latest_runs AS (
        SELECT DISTINCT ON (parser_name) id, parser_name, status, started_at
        FROM parser_runs
        ORDER BY parser_name, started_at DESC
      ),
      run_stats AS (
        SELECT
          run_id,
          COUNT(CASE WHEN state = 'success' THEN 1 END)::int AS success_count,
          COUNT(*)::int AS total_count
        FROM run_tasks
        WHERE run_id IN (SELECT id FROM latest_runs)
        GROUP BY run_id
      )
      SELECT
        p.id          AS parser_id,
        p.name,
        lr.id         AS run_id,
        lr.status     AS run_status,
        lr.started_at AS started_at,
        COALESCE(rs.success_count, 0) AS success_count,
        COALESCE(rs.total_count,   0) AS total_count
      FROM parsers p
      LEFT JOIN latest_runs lr  ON lr.parser_name = p.name
      LEFT JOIN run_stats    rs ON rs.run_id = lr.id
      WHERE p.name ILIKE ${pattern}
        AND p.organization_id = ${orgId}
      ORDER BY p.name ASC
    `)

    return (result.rows as Row[]).map((r) => ({
      id: r.parser_id,
      name: r.name,
      dbStatus: (r.run_status === 'running'
        ? 'running'
        : r.run_status === 'stopped'
          ? 'stopped'
          : r.run_status === 'failed'
            ? 'idle'
            : 'idle') as 'running' | 'stopped' | 'idle',
      lastRunDate: r.started_at
        ? r.started_at instanceof Date
          ? r.started_at.toISOString()
          : String(r.started_at)
        : null,
      lastRunId: r.run_id ?? null,
      successRate: r.total_count > 0 ? Math.round((r.success_count / r.total_count) * 100) : null,
    }))
  }

  /** Returns daily run counts for the last 30 days. Dates with no runs are omitted from the result. */
  async getPerformanceLast30Days(): Promise<
    { date: string; successful: number; failed: number }[]
  > {
    type Row = { date: string; successful: number; failed: number }

    const result = await this.db.execute<Row>(sql`
      SELECT
        TO_CHAR(DATE(started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
        COUNT(CASE WHEN status IN ('completed') THEN 1 END)::int    AS successful,
        COUNT(CASE WHEN status IN ('failed')    THEN 1 END)::int    AS failed
      FROM parser_runs
      WHERE started_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(started_at AT TIME ZONE 'UTC')
      ORDER BY date ASC
    `)

    return result.rows as Row[]
  }

  async getParserStats(parserName: string): Promise<ParserStats> {
    type Row = {
      total_runs: number
      successful_runs: number
      avg_duration_seconds: number | null
    }
    const result = await this.db.execute<Row>(sql`
      SELECT
        COUNT(*)::int                                                        AS total_runs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::int               AS successful_runs,
        ROUND(AVG(
          CASE WHEN stopped_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (stopped_at - started_at))
          END
        ))::int                                                              AS avg_duration_seconds
      FROM parser_runs
      WHERE parser_name = ${parserName}
    `)
    const row = result.rows[0] as Row | undefined
    if (!row || row.total_runs === 0) {
      return { totalRuns: 0, successRate: null, avgDurationSeconds: null }
    }
    return {
      totalRuns: row.total_runs,
      successRate: Math.round((row.successful_runs / row.total_runs) * 100),
      avgDurationSeconds: row.avg_duration_seconds,
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _bulkUpsertTasks(runId: string, tasks: PageTask[]): Promise<void> {
    if (tasks.length === 0) return
    const BATCH = 500
    const now = new Date()
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < tasks.length; i += BATCH) {
        const chunk = tasks.slice(i, i + BATCH)
        await tx
          .insert(runTasks)
          .values(
            chunk.map((t) => ({
              id: t.id,
              runId,
              url: t.url,
              stepName: String(t.stepName),
              stepType: t.stepType,
              state: t.state,
              attempts: t.attempts,
              maxAttempts: t.maxAttempts,
              error: t.error ?? null,
              parentTaskId: t.parentTaskId ?? null,
              parent_data: t.parent_data ?? null,
              updatedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: runTasks.id,
            set: {
              state: sql`excluded.state`,
              attempts: sql`excluded.attempts`,
              error: sql`excluded.error`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
      }
    })
  }

  private async _bulkSaveResults(
    batch: { taskId: string; rows: Record<string, unknown>[] }[],
  ): Promise<void> {
    if (batch.length === 0) return
    const BATCH = 500
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < batch.length; i += BATCH) {
        const chunk = batch.slice(i, i + BATCH)
        await tx
          .insert(taskResults)
          .values(chunk.map((b) => ({ taskId: b.taskId, rows: b.rows })))
          .onConflictDoUpdate({ target: taskResults.taskId, set: { rows: sql`excluded.rows` } })
      }
    })
  }

  private async _computeStats(runId: string): Promise<RunStats | null> {
    const rows = await this.db
      .select({
        runId: runTasks.runId,
        state: runTasks.state,
        stepType: runTasks.stepType,
        count: sql<number>`count(*)::int`,
      })
      .from(runTasks)
      .where(eq(runTasks.runId, runId))
      .groupBy(runTasks.runId, runTasks.state, runTasks.stepType)

    const itemResult = await this.db.execute<{ total: number }>(sql`
      SELECT COALESCE(SUM(jsonb_array_length(tr.rows)), 0)::int AS total
      FROM run_tasks rt
      JOIN task_results tr ON tr.task_id = rt.id
      WHERE rt.run_id = ${runId}
        AND rt.step_type = 'extractor'
    `)
    const totalItems = itemResult.rows[0]?.total ?? 0

    return this._computeStatsFromRows(rows, totalItems)
  }

  private _computeStatsFromRows(
    rows: { state: string; stepType: string; count: number }[],
    totalItems = 0,
  ): RunStats | null {
    if (rows.length === 0) return null
    const total = rows.reduce((s, r) => s + r.count, 0)
    const get = (state: string) =>
      rows.filter((r) => r.state === state).reduce((s, r) => s + r.count, 0)
    const getType = (type: string, state: string) =>
      rows.find((r) => r.stepType === type && r.state === state)?.count ?? 0
    const typeTotal = (type: string) =>
      rows.filter((r) => r.stepType === type).reduce((s, r) => s + r.count, 0)
    return {
      total,
      pending: get('pending'),
      retry: get('retry'),
      success: get('success'),
      failed: get('failed'),
      aborted: get('aborted'),
      inProgress: get('in_progress'),
      traversers: {
        total: typeTotal('traverser'),
        success: getType('traverser', 'success'),
        failed: getType('traverser', 'failed'),
      },
      extractors: {
        total: typeTotal('extractor'),
        success: getType('extractor', 'success'),
        failed: getType('extractor', 'failed'),
      },
      totalItems,
    }
  }
}
