import type { PageTask } from '../../domain/entities/PageTask.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

export type BrowserSettings = Pick<StepSettings, 'browser_type' | 'launchOptions' | 'contextOptions' | 'initScripts' | 'userAgent' | 'proxySettings'>

export type WorkerData =
  | { parserFilePath: string; stepName: string; browserSettings?: BrowserSettings }
  | { stepCode: string; stepType: 'traverser' | 'extractor'; outputFile?: string; stepSettings?: StepSettings; stepName: string; browserSettings?: BrowserSettings }

// Messages sent from Main → Worker
export type WorkerInMessage =
  | { type: 'PROCESS_PAGE'; task: PageTask }
  | { type: 'STOP' }

// Messages sent from Worker → Main
export type WorkerOutMessage =
  | { type: 'LINKS_DISCOVERED'; taskId: string; items: TraverserResult[] }
  | { type: 'DATA_EXTRACTED'; taskId: string; rows: Record<string, unknown>[]; outputFile: string }
  | { type: 'PAGE_SUCCESS'; taskId: string }
  | { type: 'PAGE_FAILED'; taskId: string; error: string }
  | { type: 'LOG'; level: 'log' | 'error'; stepName: string; args: string[] }
