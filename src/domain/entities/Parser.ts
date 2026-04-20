import type { Page } from 'playwright'
import type { StepName } from '../value-objects/StepName.js'
import { stepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { TraverserResult } from '../value-objects/TraverserResult.js'
import { Traverser } from './Traverser.js'
import { Extractor } from './Extractor.js'
import type { Step } from './Step.js'
import type { PageTask } from './PageTask.js'

type TraverserDef = {
  type: 'traverser'
  settings?: StepSettings
  run: (page: Page, task: PageTask) => Promise<TraverserResult[]>
}

type ExtractorDef = {
  type: 'extractor'
  outputFile?: string
  settings?: StepSettings
  run: (page: Page, task: PageTask) => Promise<Record<string, unknown>[]>
}

type StepDef = TraverserDef | ExtractorDef

export interface ParserConfig {
  name: string
  entryUrl: string
  entryStep: StepName
  steps: Map<StepName, Step>
  retryConfig: RetryConfig
  deduplication: boolean
  filePath?: string
}

export interface ParserDefinition {
  name: string
  entryUrl: string
  entryStep?: string
  retryConfig?: Partial<RetryConfig>
  deduplication?: boolean
  steps: Record<string, StepDef>
}

export function defineParser(def: ParserDefinition): ParserConfig {
  const steps = new Map<StepName, Step>()
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
  }
}
