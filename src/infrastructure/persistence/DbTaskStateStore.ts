// src/infrastructure/persistence/DbTaskStateStore.ts
import type { TaskStateStore } from '../../domain/services/TaskStateStore.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepType } from '../../domain/entities/Step.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { RetryConfig } from '../../domain/value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../../domain/value-objects/RetryConfig.js'
import { createPageTask } from '../../domain/entities/PageTask.js'
import { PageState } from '../../domain/value-objects/PageState.js'
import type { RunPersistenceService, StoredTask } from '../db/RunPersistenceService.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

const CACHE_MAX = 5_000

function emptyStats(): RunStats {
  return {
    total: 0,
    pending: 0,
    retry: 0,
    success: 0,
    failed: 0,
    aborted: 0,
    inProgress: 0,
    traversers: { total: 0, success: 0, failed: 0 },
    extractors: { total: 0, success: 0, failed: 0 },
  }
}

function statsTypeKey(stepType: StepType): 'traversers' | 'extractors' {
  return stepType === 'traverser' ? 'traversers' : 'extractors'
}

export class DbTaskStateStore implements TaskStateStore {
  private cache = new Map<string, PageTask>()
  private locks = new Map<string, Promise<unknown>>()
  private _stats: RunStats = emptyStats()

  constructor(
    public readonly runId: string,
    private readonly persistence: RunPersistenceService,
  ) {}

  private touch(task: PageTask): PageTask {
    if (this.cache.size >= CACHE_MAX) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(task.id, task)
    return task
  }

  private storedToTask(s: StoredTask): PageTask {
    return {
      id: s.id,
      url: s.url,
      stepName: s.stepName as unknown as StepName,
      stepType: s.stepType,
      state: s.state as PageTask['state'],
      attempts: s.attempts,
      maxAttempts: s.maxAttempts,
      error: s.error ?? undefined,
      parentTaskId: s.parentTaskId ?? undefined,
      parent_data: (s.parent_data ?? undefined) as Record<string, unknown> | undefined,
    } as PageTask
  }

  private applyStatsDelta(prev: PageTask | undefined, next: PageTask): void {
    const s = this._stats
    if (prev) {
      switch (prev.state) {
        case PageState.Pending:
          s.pending--
          break
        case PageState.Retry:
          s.retry--
          break
        case PageState.InProgress:
          s.inProgress--
          break
        case PageState.Success:
          s.success--
          s[statsTypeKey(prev.stepType)].success--
          break
        case PageState.Failed:
          s.failed--
          s[statsTypeKey(prev.stepType)].failed--
          break
        case PageState.Aborted:
          s.aborted--
          break
      }
    }
    switch (next.state) {
      case PageState.Pending:
        s.pending++
        break
      case PageState.Retry:
        s.retry++
        break
      case PageState.InProgress:
        s.inProgress++
        break
      case PageState.Success:
        s.success++
        s[statsTypeKey(next.stepType)].success++
        break
      case PageState.Failed:
        s.failed++
        s[statsTypeKey(next.stepType)].failed++
        break
      case PageState.Aborted:
        s.aborted++
        break
    }
  }

  async addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parent_data?: Record<string, unknown>,
  ): Promise<PageTask> {
    const task = createPageTask(url, step, stepType, retryConfig, parentTaskId, parent_data)
    this.touch(task)
    this._stats.total++
    this._stats[statsTypeKey(stepType)].total++
    this.applyStatsDelta(undefined, task)
    await this.persistence.upsertTask(this.runId, task)
    return task
  }

  async restoreTask(task: PageTask): Promise<void> {
    this.touch(task)
  }

  async getTask(id: string): Promise<PageTask | undefined> {
    const hit = this.cache.get(id)
    if (hit) return hit
    const stored = await this.persistence.getTask(this.runId, id)
    if (!stored) return undefined
    return this.touch(this.storedToTask(stored))
  }

  private async mutate(id: string, fn: (t: PageTask) => PageTask): Promise<PageTask> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    let unlock!: () => void
    const lock = new Promise<void>((r) => {
      unlock = r
    })
    this.locks.set(id, lock)

    await prev
    try {
      const current = await this.getTask(id)
      if (!current) throw new Error(`Task ${id} not found`)
      const next = fn(current)
      this.applyStatsDelta(current, next)
      this.touch(next)
      await this.persistence.upsertTask(this.runId, next)
      return next
    } finally {
      unlock()
      if (this.locks.get(id) === lock) this.locks.delete(id)
    }
  }

  async markInProgress(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.InProgress, attempts: t.attempts + 1 }))
  }
  async markPending(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Pending, error: undefined }))
  }
  async markRetry(id: string, error: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Retry, error }))
  }
  async markSuccess(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Success, error: undefined }))
  }
  async markFailed(id: string, error: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Failed, error }))
  }
  async markAborted(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Aborted }))
  }

  async isComplete(): Promise<boolean> {
    if (this._stats.total === 0) return false
    const terminal = this._stats.success + this._stats.failed + this._stats.aborted
    return terminal >= this._stats.total
  }

  async getStats(): Promise<RunStats> {
    return {
      ...this._stats,
      traversers: { ...this._stats.traversers },
      extractors: { ...this._stats.extractors },
    }
  }

  async allTasks(): Promise<PageTask[]> {
    await this.persistence.flushPendingWrites()
    const { tasks } = await this.persistence.getRunTasks(this.runId, 1, 100_000)
    const pageTasks = tasks.map((s) => this.storedToTask(s))
    this._stats = emptyStats()
    for (const t of pageTasks) {
      this.touch(t)
      this._stats.total++
      this._stats[statsTypeKey(t.stepType)].total++
      this.applyStatsDelta(undefined, t)
    }
    return pageTasks
  }
}
