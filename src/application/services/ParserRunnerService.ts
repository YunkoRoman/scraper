import { EventEmitter } from 'node:events'
import { RunParser } from '../use-cases/RunParser.js'
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

export class ParserRunnerService extends EventEmitter {
  private activeRuns = new Map<string, ParserOrchestrator>()
  private lastStats = new Map<string, RunStats>()

  constructor(private readonly runParser: RunParser) {
    super()
  }

  async run(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }
    const orchestrator = await this.runParser.execute(
      parserName,
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('complete', parserName, s)
        this.activeRuns.delete(parserName)
      },
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this.activeRuns.set(parserName, orchestrator)
  }

  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.stop()
    this.activeRuns.delete(parserName)
    this.emit('stopped', parserName)
  }

  getStats(parserName: string): RunStats | undefined {
    const orchestrator = this.activeRuns.get(parserName)
    if (orchestrator) return orchestrator.getStats()
    return this.lastStats.get(parserName)
  }

  isRunning(parserName: string): boolean {
    return this.activeRuns.has(parserName)
  }

  listRunning(): string[] {
    return [...this.activeRuns.keys()]
  }
}
