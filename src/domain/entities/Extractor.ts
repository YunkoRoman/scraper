import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'

export class Extractor extends Step {
  readonly type = 'extractor' as const

  constructor(
    name: StepName,
    readonly dataSelectors: Record<string, string>,
    readonly outputFile: string,
  ) {
    super(name)
  }
}
