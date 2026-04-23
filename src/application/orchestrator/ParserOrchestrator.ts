import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import { ParserRun, type RunStats } from '../../domain/entities/ParserRun.js'
import type { Step } from '../../domain/entities/Step.js'
import { LinkDeduplicator } from '../../domain/services/LinkDeduplicator.js'
import { CsvWriter } from '../../infrastructure/csv/CsvWriter.js'
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import { mkdir } from 'node:fs/promises'
import { PageState } from '../../domain/value-objects/PageState.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// Detect tsx (dev) vs compiled JS to resolve worker file extension correctly
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
  ) {
    super()
    this.run = new ParserRun(config.name)
    this.deduplicator = new LinkDeduplicator(config.deduplication)
    this.outputDir = resolve(outputBaseDir, config.name)
  }

  async start(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })

    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve
    })

    for (const [, step] of this.config.steps) {
      this.spawnWorker(step)
    }

    const initialUrls = this.deduplicator.filter([this.config.entryUrl])
    const entryStepType = this.config.steps.get(this.config.entryStep)?.type ?? 'traverser'
    for (const url of initialUrls) {
      const task = this.run.addTask(url, this.config.entryStep, entryStepType, this.config.retryConfig)
      this.dispatchTask(task.id)
    }

    this.emit('stats', this.run.getStats())

    return this.completionPromise
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const task of this.run.allTasks()) {
      if (task.state === PageState.Pending || task.state === PageState.Retry) {
        this.run.markAborted(task.id)
      }
    }
    const exitPromises = [...this.workers.values()].map(
      (worker) =>
        new Promise<void>((resolve) => {
          worker.once('exit', () => resolve())
          worker.postMessage({ type: 'STOP' })
          // Forcefully terminate if worker doesn't exit within 5s
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
    if (!this.config.filePath) {
      throw new Error('ParserConfig.filePath not set — load parser via FileParserLoader')
    }
    console.log(`[orchestrator] spawning worker: ${step.name} (${step.type})`)

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
    const wData = isTsx
      ? { parserFilePath: this.config.filePath, stepName: step.name, __workerPath: tsWorkerFile, browserSettings: this.config.browserSettings }
      : { parserFilePath: this.config.filePath, stepName: step.name, browserSettings: this.config.browserSettings }

    console.log(`[orchestrator] worker file: ${entryFile}`)
    const worker = new Worker(entryFile, { workerData: wData })
    worker.on('message', (msg: WorkerOutMessage) => this.handleWorkerMessage(msg))
    worker.on('error', (err) => this.emit('error', err))
    this.workers.set(step.name, worker)
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
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
        break
      }
      case 'PAGE_SUCCESS': {
        this.globalActive--
        this.run.markSuccess(msg.taskId)
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
        const task = this.run.getTask(msg.taskId)!
        if (task.attempts < task.maxAttempts) {
          this.run.markRetry(msg.taskId, msg.error)
          this.emit('stats', this.run.getStats())
          this.dispatchTask(msg.taskId)
        } else {
          this.run.markFailed(msg.taskId, msg.error)
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
      this.emit('stats', this.run.getStats())
      this.checkCompletion()
      return
    }
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
