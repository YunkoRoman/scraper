import type { PageTask } from '../../domain/entities/PageTask.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'

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
