import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { PageTask } from './PageTask.js'

export class Extractor<P = import('playwright').Page> extends Step<P> {
  readonly type = 'extractor' as const
  code?: string

  constructor(
    name: StepName,
    readonly run: (page: P, task: PageTask) => Promise<Record<string, unknown>[]>,
    readonly outputFile: string,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
