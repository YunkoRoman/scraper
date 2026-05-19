import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import { buildContextOptions } from './buildContextOptions.js'

export function mergeWorkerSettings(
  browserSettings: StepSettings | undefined,
  stepSettings: StepSettings | undefined,
): StepSettings {
  return {
    ...browserSettings,
    ...stepSettings,
    contextOptions: buildContextOptions(browserSettings, stepSettings),
    initScripts: [
      ...(browserSettings?.initScripts ?? []),
      ...(stepSettings?.initScripts ?? []),
    ],
  }
}
