import type { Page } from 'playwright'
import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { PageTask } from './PageTask.js'

export class Extractor extends Step {
  readonly type = 'extractor' as const

  constructor(
    name: StepName,
    readonly run: (page: Page, task: PageTask) => Promise<Record<string, unknown>[]>,
    readonly outputFile: string,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
