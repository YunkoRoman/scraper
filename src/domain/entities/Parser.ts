import type { StepName } from '../value-objects/StepName.js'
import { stepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { Traverser } from './Traverser.js'
import { Extractor } from './Extractor.js'
import type { Step } from './Step.js'

type TraverserDef = {
  type: 'traverser'
  linkSelector: string
  nextStep: string | string[]
  parentDataSelectors?: Record<string, string>
  nextPageSelector?: string
}

type ExtractorDef = {
  type: 'extractor'
  dataSelectors: Record<string, string>
  outputFile: string
}

type StepDef = TraverserDef | ExtractorDef

export interface ParserConfig {
  name: string
  entryUrl: string
  entryStep: StepName
  steps: Map<StepName, Step>
  retryConfig: RetryConfig
  deduplication: boolean
}

export interface ParserDefinition {
  name: string
  entryUrl: string
  entryStep: string
  retryConfig?: Partial<RetryConfig>
  deduplication?: boolean
  steps: Record<string, StepDef>
}

export function defineParser(def: ParserDefinition): ParserConfig {
  const steps = new Map<StepName, Step>()

  for (const [name, stepDef] of Object.entries(def.steps)) {
    const sn = stepName(name)
    if (stepDef.type === 'traverser') {
      const nextSteps = Array.isArray(stepDef.nextStep)
        ? stepDef.nextStep.map(stepName)
        : stepName(stepDef.nextStep)
      steps.set(
        sn,
        new Traverser(
          sn,
          stepDef.linkSelector,
          nextSteps,
          stepDef.parentDataSelectors,
          stepDef.nextPageSelector,
        ),
      )
    } else {
      steps.set(sn, new Extractor(sn, stepDef.dataSelectors, stepDef.outputFile))
    }
  }

  return {
    name: def.name,
    entryUrl: def.entryUrl,
    entryStep: stepName(def.entryStep),
    steps,
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...def.retryConfig },
    deduplication: def.deduplication ?? true,
  }
}
