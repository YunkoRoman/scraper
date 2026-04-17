import type { StepName } from '../value-objects/StepName.js'
import { PageState } from '../value-objects/PageState.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { randomUUID } from 'node:crypto'

export interface PageTask {
  readonly id: string
  readonly url: string
  readonly stepName: StepName
  readonly state: PageState
  readonly attempts: number
  readonly maxAttempts: number
  readonly error?: string
  readonly parentTaskId?: string
  readonly parentData?: Record<string, string>
}

export function createPageTask(
  url: string,
  step: StepName,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  parentTaskId?: string,
  parentData?: Record<string, string>,
): PageTask {
  return {
    id: randomUUID(),
    url,
    stepName: step,
    state: PageState.Pending,
    attempts: 0,
    maxAttempts: retryConfig.maxRetries,
    parentTaskId,
    parentData,
  }
}
