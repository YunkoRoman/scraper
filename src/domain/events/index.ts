import type { StepName } from '../value-objects/StepName.js'

export interface LinksDiscovered {
  type: 'LinksDiscovered'
  taskId: string
  links: string[]
  nextStep: StepName
  parentData?: Record<string, string>
}

export interface DataExtracted {
  type: 'DataExtracted'
  taskId: string
  data: Record<string, string>
  outputFile: string
}

export interface PageSucceeded {
  type: 'PageSucceeded'
  taskId: string
}

export interface PageFailed {
  type: 'PageFailed'
  taskId: string
  error: string
}

export interface PageRetried {
  type: 'PageRetried'
  taskId: string
  attempt: number
}

export type DomainEvent =
  | LinksDiscovered
  | DataExtracted
  | PageSucceeded
  | PageFailed
  | PageRetried
