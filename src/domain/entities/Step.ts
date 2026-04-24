import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'

export type StepType = 'traverser' | 'extractor'

// P is the browser Page type: import('playwright').Page by default,
// or import('puppeteer').Page when settings.browser_type === 'puppeteer'.
export abstract class Step<P = import('playwright').Page> {
  abstract readonly type: StepType
  code?: string
  constructor(
    readonly name: StepName,
    readonly settings?: StepSettings,
  ) {}
}
