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
  readonly startedAt = new Date()
  constructor(readonly parserName: string, id?: string) {
    this.id = id ?? randomUUID()
  }
  elapsedMs(): number { return Date.now() - this.startedAt.getTime() }
}
