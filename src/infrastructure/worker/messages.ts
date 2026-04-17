import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

// Messages sent from Main → Worker
export type WorkerInMessage =
  | { type: 'PROCESS_PAGE'; task: PageTask }
  | { type: 'STOP' }

// Messages sent from Worker → Main
export type WorkerOutMessage =
  | {
      type: 'LINKS_DISCOVERED'
      taskId: string
      links: string[]
      nextStep: StepName
      parentData?: Record<string, string>
    }
  | { type: 'DATA_EXTRACTED'; taskId: string; data: Record<string, string>; outputFile: string }
  | { type: 'PAGE_SUCCESS'; taskId: string }
  | { type: 'PAGE_FAILED'; taskId: string; error: string }
