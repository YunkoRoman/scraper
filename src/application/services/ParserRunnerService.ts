import { RunParser } from '../use-cases/RunParser.js'
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'

export class ParserRunnerService {
  private activeRuns = new Map<string, ParserOrchestrator>()

  constructor(private readonly runParser: RunParser) {}

  async run(
    parserName: string,
    onStats: (name: string, stats: unknown) => void,
    onComplete: (name: string, stats: unknown) => void,
    onPostProcess: (name: string, filePath: string) => void,
  ): Promise<void> {
    const orchestrator = await this.runParser.execute(
      parserName,
      (stats) => onStats(parserName, stats),
      (stats) => {
        onComplete(parserName, stats)
        this.activeRuns.delete(parserName)
      },
      (filePath) => onPostProcess(parserName, filePath),
    )
    this.activeRuns.set(parserName, orchestrator)
  }

  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.stop()
    this.activeRuns.delete(parserName)
  }

  getStatus(parserName: string): unknown {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    return orchestrator.getStats()
  }

  isRunning(parserName: string): boolean {
    return this.activeRuns.has(parserName)
  }
}
