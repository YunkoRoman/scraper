import { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { IParserLoader } from '../../infrastructure/loader/IParserLoader.js'

export class RunParser {
  constructor(
    private readonly loader: IParserLoader,
    private readonly outputDir: string,
  ) {}

  async execute(
    parserName: string,
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): Promise<ParserOrchestrator> {
    const config = await this.loader.load(parserName)
    const orchestrator = new ParserOrchestrator(config, this.outputDir)
    orchestrator.on('stats', onStats)
    orchestrator.on('complete', onComplete)
    orchestrator.on('postprocess', onPostProcess)
    // Prevent uncaught exception crash — EventEmitter throws if no 'error' listener
    orchestrator.on('error', (err: Error) =>
      console.error(`[${parserName}] Worker error:`, err.message),
    )
    orchestrator.start().catch((err) => console.error(`[${parserName}] Start error:`, err))
    return orchestrator
  }
}
