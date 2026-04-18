import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'

export class StopParser {
  async execute(orchestrator: ParserOrchestrator): Promise<void> {
    await orchestrator.stop()
  }
}
