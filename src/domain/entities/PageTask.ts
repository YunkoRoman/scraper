import type { StepName } from '../value-objects/StepName.js'
import type { StepType } from '../entities/Step.js'
import { PageState } from '../value-objects/PageState.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { randomUUID } from 'node:crypto'

export interface PageTask {
  readonly id: string
  readonly url: string
  readonly stepName: StepName
  readonly stepType: StepType
  readonly state: PageState
  readonly attempts: number
  readonly maxAttempts: number
  readonly error?: string
  readonly parentTaskId?: string
  readonly parentData?: Record<string, unknown>
}

export function createPageTask(
  url: string,
  step: StepName,
  stepType: StepType,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  parentTaskId?: string,
  parentData?: Record<string, unknown>,
): PageTask {
  return {
    id: randomUUID(),
    url,
    stepName: step,
    stepType,
    state: PageState.Pending,
    attempts: 0,
    maxAttempts: retryConfig.maxRetries,
    parentTaskId,
    parentData,
  }
}
