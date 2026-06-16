// src/domain/services/TaskStateStore.ts
import type { PageTask } from '../entities/PageTask.js'
import type { StepType } from '../entities/Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import type { RunStats } from '../entities/ParserRun.js'
import { PageState, isTerminal } from '../value-objects/PageState.js'
import { createPageTask } from '../entities/PageTask.js'

export interface TaskStateStore {
  addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig?: RetryConfig,
    parentTaskId?: string,
    parent_data?: Record<string, unknown>,
  ): Promise<PageTask>

  restoreTask(task: PageTask): Promise<void>
  getTask(id: string): Promise<PageTask | undefined>

  markInProgress(id: string): Promise<PageTask>
  markPending(id: string): Promise<PageTask>
  markRetry(id: string, error: string): Promise<PageTask>
  markSuccess(id: string): Promise<PageTask>
  markFailed(id: string, error: string): Promise<PageTask>
  markAborted(id: string): Promise<PageTask>

  allTasks(): Promise<PageTask[]>
  isComplete(): Promise<boolean>
  getStats(): Promise<RunStats>
}

export class InMemoryTaskStateStore implements TaskStateStore {
  private tasks = new Map<string, PageTask>()

  constructor(readonly runId: string) {}

  async addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parent_data?: Record<string, unknown>,
  ): Promise<PageTask> {
    const task = createPageTask(url, step, stepType, retryConfig, parentTaskId, parent_data)
    this.tasks.set(task.id, task)
    return task
  }

  async restoreTask(task: PageTask): Promise<void> {
    this.tasks.set(task.id, task)
  }

  async getTask(id: string): Promise<PageTask | undefined> {
    return this.tasks.get(id)
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

  async allTasks(): Promise<PageTask[]> {
    return [...this.tasks.values()]
  }

  async isComplete(): Promise<boolean> {
    if (this.tasks.size === 0) return false
    return [...this.tasks.values()].every((t) => isTerminal(t.state))
  }

  async getStats(): Promise<RunStats> {
    const tasks = [...this.tasks.values()]
    const byType = (type: StepType) => {
      const subset = tasks.filter((t) => t.stepType === type)
      return {
        total: subset.length,
        success: subset.filter((t) => t.state === PageState.Success).length,
        failed: subset.filter((t) => t.state === PageState.Failed).length,
      }
    }
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.state === PageState.Pending).length,
      retry: tasks.filter((t) => t.state === PageState.Retry).length,
      success: tasks.filter((t) => t.state === PageState.Success).length,
      failed: tasks.filter((t) => t.state === PageState.Failed).length,
      aborted: tasks.filter((t) => t.state === PageState.Aborted).length,
      inProgress: tasks.filter((t) => t.state === PageState.InProgress).length,
      traversers: byType('traverser'),
      extractors: byType('extractor'),
      totalItems: 0,
    }
  }

  private async mutate(id: string, fn: (t: PageTask) => PageTask): Promise<PageTask> {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    const next = fn(task)
    this.tasks.set(id, next)
    return next
  }
}
