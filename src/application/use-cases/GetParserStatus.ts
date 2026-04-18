import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

export class GetParserStatus {
  execute(orchestrator: ParserOrchestrator): RunStats {
    return orchestrator.getStats()
  }
}
