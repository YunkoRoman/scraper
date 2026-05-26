import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

export class GetParserStatus {
  async execute(orchestrator: ParserOrchestrator): Promise<RunStats> {
    return orchestrator.getStats()
  }
}
