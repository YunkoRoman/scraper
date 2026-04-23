import type { StepName } from '../value-objects/StepName.js'
import { stepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { TraverserResult } from '../value-objects/TraverserResult.js'
import { Traverser } from './Traverser.js'
import { Extractor } from './Extractor.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { Step } from './Step.js'
import type { PageTask } from './PageTask.js'

// P allows developers to type the page parameter correctly per browser.
// Default is Playwright's Page. Use import('puppeteer').Page for puppeteer steps.
type TraverserDef<P = import('playwright').Page> = {
  type: 'traverser'
  settings?: StepSettings
  run: (page: P, task: PageTask) => Promise<TraverserResult[]>
}

type ExtractorDef<P = import('playwright').Page> = {
  type: 'extractor'
  outputFile?: string
  settings?: StepSettings
  run: (page: P, task: PageTask) => Promise<Record<string, unknown>[]>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepDef = TraverserDef<any> | ExtractorDef<any>

export interface ParserConfig {
  name: string
  entryUrl: string
  entryStep: StepName
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: Map<StepName, Step<any>>
  retryConfig: RetryConfig
  deduplication: boolean
  concurrentQuota?: number
  browserSettings?: Pick<StepSettings, 'browser_type' | 'launchOptions' | 'contextOptions' | 'initScripts' | 'userAgent' | 'proxySettings'>
  filePath?: string
}

export interface ParserDefinition {
  name: string
  entryUrl: string
  entryStep?: string
  retryConfig?: Partial<RetryConfig>
  deduplication?: boolean
  concurrentQuota?: number
  browserSettings?: Pick<StepSettings, 'browser_type' | 'launchOptions' | 'contextOptions' | 'initScripts' | 'userAgent' | 'proxySettings'>
  steps: Record<string, StepDef>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineParser(def: ParserDefinition): ParserConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps = new Map<StepName, Step<any>>()
  const stepKeys = Object.keys(def.steps)

  for (const [name, stepDef] of Object.entries(def.steps)) {
    const sn = stepName(name)
    if (stepDef.type === 'traverser') {
      steps.set(sn, new Traverser(sn, stepDef.run, stepDef.settings))
    } else {
      const outFile = stepDef.outputFile ?? `${name}.csv`
      steps.set(sn, new Extractor(sn, stepDef.run, outFile, stepDef.settings))
    }
  }

  const entry = def.entryStep ?? stepKeys[0]
  if (!entry) throw new Error('Parser must have at least one step')

  return {
    name: def.name,
    entryUrl: def.entryUrl,
    entryStep: stepName(entry),
    steps,
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...def.retryConfig },
    deduplication: def.deduplication ?? true,
    concurrentQuota: def.concurrentQuota,
    browserSettings: def.browserSettings,
  }
}
