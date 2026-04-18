import type { RunStats } from '../domain/entities/ParserRun.js'

export class ConsoleReporter {
  private startTimes = new Map<string, number>()

  start(parserName: string): void {
    this.startTimes.set(parserName, Date.now())
    process.stdout.write(`\n[${parserName}] Starting...\n`)
  }

  update(parserName: string, stats: RunStats): void {
    process.stdout.write(
      `\r[${parserName}] Pages: Total ${stats.total} | ` +
        `Success ${stats.success} | Failed ${stats.failed} | ` +
        `Retry ${stats.retry} | In Progress ${stats.inProgress}  `,
    )
  }

  complete(parserName: string, stats: RunStats): void {
    const elapsed = this.formatElapsed(parserName)
    process.stdout.write(
      `\n[${parserName}] Completed in ${elapsed}\n` +
        `  Pages: Total ${stats.total} | Success ${stats.success} | Failed ${stats.failed}\n`,
    )
  }

  postProcess(parserName: string, filePath: string): void {
    process.stdout.write(`  CSV post-processed: ${filePath}\n`)
  }

  error(parserName: string, err: Error): void {
    process.stderr.write(`\n[${parserName}] ERROR: ${err.message}\n`)
  }

  private formatElapsed(parserName: string): string {
    const startTime = this.startTimes.get(parserName)
    if (!startTime) return '?'
    const ms = Date.now() - startTime
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`
  }
}
