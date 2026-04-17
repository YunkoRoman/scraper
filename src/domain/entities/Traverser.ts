import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'

export class Traverser extends Step {
  readonly type = 'traverser' as const

  constructor(
    name: StepName,
    readonly linkSelector: string,
    readonly nextStep: StepName | StepName[],
    readonly parentDataSelectors?: Record<string, string>,
    readonly nextPageSelector?: string,
  ) {
    super(name)
  }
}
