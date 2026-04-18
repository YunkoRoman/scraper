import { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import { FileParserLoader } from '../../infrastructure/loader/FileParserLoader.js'

export class RunParser {
  constructor(
    private readonly loader: FileParserLoader,
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
    orchestrator.start().catch(console.error)
    return orchestrator
  }
}
