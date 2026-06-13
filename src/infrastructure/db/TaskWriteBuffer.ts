// src/infrastructure/db/TaskWriteBuffer.ts
import type { PageTask } from '../../domain/entities/PageTask.js'

export interface TaskSink {
  /** Bulk-write a batch of task upserts, grouped by runId. */
  flushTaskBatch(batch: { runId: string; tasks: PageTask[] }[]): Promise<void>
  /** Bulk-write task result rows. */
  flushResultBatch(batch: { taskId: string; rows: Record<string, unknown>[] }[]): Promise<void>
}

export interface TaskWriteBufferOptions {
  flushIntervalMs?: number
  maxBatchSize?: number
}

/**
 * Coalescing buffer for task upserts and result writes.
 *
 * - Task upserts are keyed by `taskId` so only the latest state per task is sent.
 * - Result writes are keyed by `taskId` (full overwrite).
 * - Flush is triggered by debounce timer (default 100 ms), size cap (default 500),
 *   or explicit flush().
 */
export class TaskWriteBuffer {
  private tasks = new Map<string, { runId: string; task: PageTask }>()
  private results = new Map<string, Record<string, unknown>[]>()
  private timer: NodeJS.Timeout | null = null
  private flushing: Promise<void> | null = null
  private readonly intervalMs: number
  private readonly maxBatchSize: number

  constructor(
    private readonly sink: TaskSink,
    opts: TaskWriteBufferOptions = {},
  ) {
    this.intervalMs = opts.flushIntervalMs ?? 100
    this.maxBatchSize = opts.maxBatchSize ?? 500
  }

  enqueueTask(runId: string, task: PageTask): void {
    this.tasks.set(task.id, { runId, task })
    this.maybeScheduleFlush()
  }

  enqueueResult(taskId: string, rows: Record<string, unknown>[]): void {
    this.results.set(taskId, rows)
    this.maybeScheduleFlush()
  }

  /** Snapshot of latest task state in the buffer (read-through helper). */
  peekTask(taskId: string): PageTask | undefined {
    return this.tasks.get(taskId)?.task
  }

  /** Wait for any in-flight flush, then flush everything currently pending. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing
    this.clearTimer()
    if (this.tasks.size === 0 && this.results.size === 0) return
    const taskEntries = [...this.tasks.values()]
    const resultEntries = [...this.results.entries()].map(([taskId, rows]) => ({ taskId, rows }))
    this.tasks.clear()
    this.results.clear()
    this.flushing = this._doFlush(taskEntries, resultEntries)
    try {
      await this.flushing
    } catch (err) {
      for (const entry of taskEntries) {
        if (!this.tasks.has(entry.task.id)) {
          this.tasks.set(entry.task.id, entry)
        }
      }
      for (const { taskId, rows } of resultEntries) {
        if (!this.results.has(taskId)) {
          this.results.set(taskId, rows)
        }
      }
      console.error('[TaskWriteBuffer] flush failed, items re-queued:', err)
      throw err
    } finally {
      this.flushing = null
    }
  }

  private async _doFlush(
    taskEntries: { runId: string; task: PageTask }[],
    resultEntries: { taskId: string; rows: Record<string, unknown>[] }[],
  ): Promise<void> {
    // Tasks MUST flush before results in every flush cycle to satisfy the
    // taskResults.taskId → runTasks.id FK constraint. Never reorder these two awaits.
    const byRun = new Map<string, PageTask[]>()
    for (const { runId, task } of taskEntries) {
      const list = byRun.get(runId) ?? []
      list.push(task)
      byRun.set(runId, list)
    }
    const taskBatch = [...byRun.entries()].map(([runId, tasks]) => ({ runId, tasks }))
    if (taskBatch.length > 0) {
      await this.sink.flushTaskBatch(taskBatch)
    }
    if (resultEntries.length > 0) {
      await this.sink.flushResultBatch(resultEntries)
    }
  }

  private maybeScheduleFlush(): void {
    if (this.tasks.size + this.results.size >= this.maxBatchSize) {
      void this.flush()
      return
    }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
