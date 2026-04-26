import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import { ParserRun, type RunStats } from '../../domain/entities/ParserRun.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Step } from '../../domain/entities/Step.js'
import { LinkDeduplicator } from '../../domain/services/LinkDeduplicator.js'
import { CsvWriter } from '../../infrastructure/csv/CsvWriter.js'
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import { mkdir } from 'node:fs/promises'
import { PageState, isTerminal } from '../../domain/value-objects/PageState.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isTsx = __filename.endsWith('.ts')

export class ParserOrchestrator extends EventEmitter {
  private run: ParserRun
  private workers = new Map<StepName, Worker>()
  private csvWriters = new Map<string, CsvWriter>()
  private pendingWrites: Promise<void>[] = []
  private deduplicator: LinkDeduplicator
  private outputDir: string
  private stopped = false
  private completing = false
  private completionPromise!: Promise<void>
  private resolveCompletion!: () => void
  private globalActive = 0
  private dispatchQueue: string[] = []

  constructor(
    private readonly config: ParserConfig,
    outputBaseDir: string,
    snapshotTasks?: PageTask[],
    runId?: string,
  ) {
    super()
    this.run = new ParserRun(config.name, runId)
    if (snapshotTasks) {
      for (const t of snapshotTasks) this.run.restoreTask(t)
    }
    this.deduplicator = new LinkDeduplicator(config.deduplication)
    this.outputDir = resolve(outputBaseDir, config.name)
  }

  get runId(): string {
    return this.run.id
  }

  getAllTasks(): PageTask[] {
    return this.run.allTasks()
  }

  retryTask(taskId: string): void {
    const task = this.run.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (task.state !== PageState.Failed && task.state !== PageState.Aborted) {
      throw new Error(`Task "${taskId}" is not failed or aborted (state: ${task.state})`)
    }
    this.run.markPending(taskId)
    this.dispatchTask(taskId)
  }

  abortTask(taskId: string): void {
    const task = this.run.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (
      task.state !== PageState.Pending &&
      task.state !== PageState.InProgress &&
      task.state !== PageState.Retry
    ) {
      throw new Error(`Task "${taskId}" cannot be aborted (state: ${task.state})`)
    }
    if (task.state === PageState.InProgress) {
      this.globalActive--
    }
    this.run.markAborted(taskId)
  }

  async start(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })

    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve
    })

    for (const [, step] of this.config.steps) {
      this.spawnWorker(step)
    }

    const snapshotTasks = this.run.allTasks()
    if (snapshotTasks.length > 0) {
      // Resume mode: seed deduplicator with succeeded URLs, re-dispatch aborted/pending tasks
      const successUrls = snapshotTasks
        .filter((t) => t.state === PageState.Success)
        .map((t) => t.url)
      this.deduplicator.seed(successUrls)

      const toDispatch = snapshotTasks.filter(
        (t) => t.state === PageState.Aborted || t.state === PageState.Pending || t.state === PageState.Retry,
      )
      for (const task of toDispatch) {
        this.run.markPending(task.id)
        this.dispatchTask(task.id)
      }
    } else {
      // Fresh start
      const initialUrls = this.deduplicator.filter([this.config.entryUrl])
      const entryStepType = this.config.steps.get(this.config.entryStep)?.type ?? 'traverser'
      for (const url of initialUrls) {
        const task = this.run.addTask(url, this.config.entryStep, entryStepType, this.config.retryConfig)
        this.dispatchTask(task.id)
      }
    }

    this.emit('stats', this.run.getStats())

    return this.completionPromise
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const task of this.run.allTasks()) {
      if (
        task.state === PageState.Pending ||
        task.state === PageState.Retry ||
        task.state === PageState.InProgress
      ) {
        this.run.markAborted(task.id)
      }
    }
    const exitPromises = [...this.workers.values()].map(
      (worker) =>
        new Promise<void>((resolve) => {
          worker.once('exit', () => resolve())
          worker.postMessage({ type: 'STOP' })
          setTimeout(() => worker.terminate().then(() => resolve()).catch(() => resolve()), 5_000)
        }),
    )
    await Promise.all(exitPromises)
    await this.closeAllWriters()
    this.resolveCompletion()
  }

  getStats(): RunStats {
    return this.run.getStats()
  }

  private spawnWorker(step: Step): void {
    const hasFilePath = !!this.config.filePath
    const hasCode = !!step.code
    if (!hasFilePath && !hasCode) {
      throw new Error(`Step "${step.name}" has no filePath or inline code`)
    }

    const bootstrapFile = resolve(__dirname, '../../infrastructure/worker/worker-bootstrap.js')
    const tsWorkerFile =
      step.type === 'traverser'
        ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
        : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
    const jsWorkerFile =
      step.type === 'traverser'
        ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
        : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')

    const entryFile = isTsx ? bootstrapFile : jsWorkerFile
    const outputFile =
      step.type === 'extractor'
        ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile
        : undefined

    const wData = hasFilePath
      ? (isTsx
          ? { parserFilePath: this.config.filePath!, stepName: String(step.name), __workerPath: tsWorkerFile, browserSettings: this.config.browserSettings }
          : { parserFilePath: this.config.filePath!, stepName: String(step.name), browserSettings: this.config.browserSettings })
      : (isTsx
          ? { stepCode: step.code!, stepType: step.type, outputFile, stepSettings: step.settings, stepName: String(step.name), __workerPath: tsWorkerFile, browserSettings: this.config.browserSettings }
          : { stepCode: step.code!, stepType: step.type, outputFile, stepSettings: step.settings, stepName: String(step.name), browserSettings: this.config.browserSettings })

    const worker = new Worker(entryFile, { workerData: wData })
    worker.on('message', (msg: WorkerOutMessage) => this.handleWorkerMessage(msg))
    worker.on('error', (err) => this.emit('error', err))
    this.workers.set(step.name, worker)
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    if (this.stopped) return
    switch (msg.type) {
      case 'LINKS_DISCOVERED': {
        const newLinks = new Set(this.deduplicator.filter(msg.items.map((i) => i.link)))
        const newItems = msg.items.filter((i) => newLinks.has(i.link))
        for (const item of newItems) {
          const stepName = item.page_type as StepName
          const stepType = this.config.steps.get(stepName)?.type ?? 'traverser'
          const task = this.run.addTask(
            item.link,
            stepName,
            stepType,
            this.config.retryConfig,
            msg.taskId,
            item.parent_data,
          )
          this.dispatchTask(task.id)
        }
        this.emit('stats', this.run.getStats())
        break
      }
      case 'DATA_EXTRACTED': {
        for (const row of msg.rows) {
          const stringRow: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) {
            stringRow[k] = v == null ? '' : String(v)
          }
          this.writeCsvRow(msg.outputFile, stringRow)
        }
        this.emit('data_extracted', { taskId: msg.taskId, rows: msg.rows })
        break
      }
      case 'PAGE_SUCCESS': {
        this.globalActive--
        const task = this.run.getTask(msg.taskId)
        if (!task || isTerminal(task.state)) {
          this.flushDispatchQueue()
          this.checkCompletion()
          break
        }
        this.run.markSuccess(msg.taskId)
        this.emit('task_done', this.run.getTask(msg.taskId)!)
        this.emit('stats', this.run.getStats())
        this.flushDispatchQueue()
        this.checkCompletion()
        break
      }
      case 'LOG': {
        const line = `[${msg.stepName}] ${msg.args.join(' ')}`
        if (msg.level === 'error') console.error(line)
        else console.log(line)
        break
      }
      case 'PAGE_FAILED': {
        this.globalActive--
        const task = this.run.getTask(msg.taskId)
        if (!task || isTerminal(task.state)) {
          this.flushDispatchQueue()
          break
        }
        if (task.attempts < task.maxAttempts) {
          this.run.markRetry(msg.taskId, msg.error)
          this.emit('stats', this.run.getStats())
          this.dispatchTask(msg.taskId)
        } else {
          this.run.markFailed(msg.taskId, msg.error)
          this.emit('task_done', this.run.getTask(msg.taskId)!)
          this.emit('stats', this.run.getStats())
          this.checkCompletion()
        }
        this.flushDispatchQueue()
        break
      }
    }
  }

  private dispatchTask(taskId: string): void {
    if (this.stopped) return
    const quota = this.config.concurrentQuota
    if (quota !== undefined && this.globalActive >= quota) {
      this.dispatchQueue.push(taskId)
      return
    }
    this._sendToWorker(taskId)
  }

  private _sendToWorker(taskId: string): void {
    const task = this.run.getTask(taskId)
    if (!task) return
    const worker = this.workers.get(task.stepName)
    if (!worker) {
      this.run.markFailed(taskId, `No worker for step "${task.stepName}"`)
      this.emit('task_done', this.run.getTask(taskId)!)
      this.emit('stats', this.run.getStats())
      this.checkCompletion()
      return
    }
    this.run.markInProgress(taskId)
    this.globalActive++
    worker.postMessage({ type: 'PROCESS_PAGE', task })
  }

  private flushDispatchQueue(): void {
    const quota = this.config.concurrentQuota
    while (
      this.dispatchQueue.length > 0 &&
      (quota === undefined || this.globalActive < quota)
    ) {
      const nextId = this.dispatchQueue.shift()!
      this._sendToWorker(nextId)
    }
  }

  private writeCsvRow(outputFile: string, data: Record<string, string>): void {
    const filePath = resolve(this.outputDir, outputFile)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, new CsvWriter(filePath))
    }
    const p = this.csvWriters.get(filePath)!.write(data).catch(console.error) as Promise<void>
    this.pendingWrites.push(p)
  }

  private checkCompletion(): void {
    if (this.stopped || this.completing || !this.run.isComplete()) return
    this.completing = true
    this.closeAllWriters()
      .then(() => this.runPostProcessing())
      .then(() => {
        this.emit('complete', this.run.getStats())
        this.resolveCompletion()
      })
      .catch((err) => this.emit('error', err))
  }

  private async closeAllWriters(): Promise<void> {
    await Promise.all(this.pendingWrites)
    this.pendingWrites = []
    await Promise.all([...this.csvWriters.values()].map((w) => w.close()))
  }

  private async runPostProcessing(): Promise<void> {
    for (const [filePath] of this.csvWriters) {
      const processor = new CsvPostProcessor(filePath)
      await processor.process()
      this.emit('postprocess', filePath)
    }
  }
}
