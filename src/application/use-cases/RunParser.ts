import { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { IParserLoader } from '../../infrastructure/loader/IParserLoader.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import { randomUUID } from 'node:crypto'
import { DbTaskStateStore } from '../../infrastructure/persistence/DbTaskStateStore.js'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'

export class RunParser {
  constructor(
    private readonly loader: IParserLoader,
    private readonly outputDir: string,
    private readonly runPersistence: RunPersistenceService,
  ) {}

  async execute(
    parserName: string,
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): Promise<ParserOrchestrator> {
    const config = await this.loader.load(parserName)
    const runId = randomUUID()
    const store = new DbTaskStateStore(runId, this.runPersistence)
    const orchestrator = new ParserOrchestrator(config, this.outputDir, store, runId)
    this._wire(orchestrator, parserName, onStats, onComplete, onPostProcess)
    orchestrator.start().catch((err) => console.error(`[${parserName}] Start error:`, err))
    return orchestrator
  }

  async resume(
    parserName: string,
    runId: string,
    snapshotTasks: PageTask[],
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): Promise<ParserOrchestrator> {
    const config = await this.loader.load(parserName)
    const store = new DbTaskStateStore(runId, this.runPersistence)
    const orchestrator = new ParserOrchestrator(config, this.outputDir, store, runId, snapshotTasks)
    this._wire(orchestrator, parserName, onStats, onComplete, onPostProcess)
    orchestrator.start().catch((err) => console.error(`[${parserName}] Resume error:`, err))
    return orchestrator
  }

  private _wire(
    orchestrator: ParserOrchestrator,
    parserName: string,
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): void {
    orchestrator.on('stats', onStats)
    orchestrator.on('complete', onComplete)
    orchestrator.on('postprocess', onPostProcess)
    orchestrator.on('error', (err: Error) =>
      console.error(`[${parserName}] Worker error:`, err.message),
    )
  }
}
