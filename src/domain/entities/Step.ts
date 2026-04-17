import type { StepName } from '../value-objects/StepName.js'

export type StepType = 'traverser' | 'extractor'

export abstract class Step {
  abstract readonly type: StepType
  constructor(readonly name: StepName) {}
}
