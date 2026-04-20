import type { Page } from 'playwright'
import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { TraverserResult } from '../value-objects/TraverserResult.js'
import type { PageTask } from './PageTask.js'

export class Traverser extends Step {
  readonly type = 'traverser' as const

  constructor(
    name: StepName,
    readonly run: (page: Page, task: PageTask) => Promise<TraverserResult[]>,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
