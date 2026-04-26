import { createPageTask, type PageTask } from './PageTask.js'
import type { StepType } from './Step.js'
import { PageState, isTerminal } from '../value-objects/PageState.js'
import type { StepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { randomUUID } from 'node:crypto'

export interface StepTypeStats {
  total: number
  success: number
  failed: number
}

export interface RunStats {
  total: number
  pending: number
  retry: number
  success: number
  failed: number
  aborted: number
  inProgress: number
  traversers: StepTypeStats
  extractors: StepTypeStats
}

export class ParserRun {
  readonly id: string
  private tasks = new Map<string, PageTask>()
  readonly startedAt = new Date()

  constructor(readonly parserName: string, id?: string) {
    this.id = id ?? randomUUID()
  }

  addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parentData?: Record<string, unknown>,
  ): PageTask {
    const task = createPageTask(url, step, stepType, retryConfig, parentTaskId, parentData)
    this.tasks.set(task.id, task)
    return task
  }

  restoreTask(task: PageTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): PageTask | undefined {
    return this.tasks.get(id)
  }

  markInProgress(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.InProgress, attempts: task.attempts + 1 })
  }

  markPending(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Pending, error: undefined })
  }

  markRetry(id: string, error: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Retry, error })
  }

  markSuccess(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Success, error: undefined })
  }

  markFailed(id: string, error: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Failed, error })
  }

  markAborted(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Aborted })
  }

  isComplete(): boolean {
    if (this.tasks.size === 0) return false
    return [...this.tasks.values()].every((t) => isTerminal(t.state))
  }

  allTasks(): PageTask[] {
    return [...this.tasks.values()]
  }

  getStats(): RunStats {
    const tasks = [...this.tasks.values()]
    const byType = (type: StepType): StepTypeStats => {
      const subset = tasks.filter((t) => t.stepType === type)
      return {
        total:   subset.length,
        success: subset.filter((t) => t.state === PageState.Success).length,
        failed:  subset.filter((t) => t.state === PageState.Failed).length,
      }
    }
    return {
      total:      tasks.length,
      pending:    tasks.filter((t) => t.state === PageState.Pending).length,
      retry:      tasks.filter((t) => t.state === PageState.Retry).length,
      success:    tasks.filter((t) => t.state === PageState.Success).length,
      failed:     tasks.filter((t) => t.state === PageState.Failed).length,
      aborted:    tasks.filter((t) => t.state === PageState.Aborted).length,
      inProgress: tasks.filter((t) => t.state === PageState.InProgress).length,
      traversers: byType('traverser'),
      extractors: byType('extractor'),
    }
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt.getTime()
  }

  private requireTask(id: string): PageTask {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return task
  }
}
