import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'

export type StepType = 'traverser' | 'extractor'

export abstract class Step {
  abstract readonly type: StepType
  constructor(
    readonly name: StepName,
    readonly settings?: StepSettings,
  ) {}
}
