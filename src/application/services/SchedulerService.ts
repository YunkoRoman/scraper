import { CronExpressionParser } from 'cron-parser'
import type { SchedulePersistenceService } from '../../infrastructure/db/SchedulePersistenceService.js'
import type { ParserPersistenceService } from '../../infrastructure/db/ParserPersistenceService.js'
import type { ParserRunnerService } from './ParserRunnerService.js'

const POLL_MS = 60_000

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly schedules: SchedulePersistenceService,
    private readonly parsers:   ParserPersistenceService,
    private readonly runner:    ParserRunnerService,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { this.tick().catch((e) => console.error('[scheduler] tick:', e)) }, POLL_MS)
    this.tick().catch((e) => console.error('[scheduler] initial tick:', e))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  static nextFireAt(cronExpression: string, from: Date = new Date()): Date | null {
    try {
      const it = CronExpressionParser.parse(cronExpression, { currentDate: from })
      return it.next().toDate()
    } catch {
      return null
    }
  }

  private async tick(): Promise<void> {
    const due = (await this.schedules.listEnabled())
      .filter((s) => s.nextRunAt !== null && s.nextRunAt.getTime() <= Date.now())
    for (const s of due) {
      const parser = await this.parsers.findById(s.parserId)
      if (!parser) continue
      if (this.runner.isRunning(parser.name)) continue
      const next = SchedulerService.nextFireAt(s.cronExpression)
      await this.schedules.update(s.id, { lastRunAt: new Date(), nextRunAt: next })
      this.runner.run(parser.name).catch((err) => console.error(`[scheduler] run "${parser.name}":`, err))
    }
  }
}
