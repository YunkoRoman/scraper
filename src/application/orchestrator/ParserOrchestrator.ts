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
const workerExt = isTsx ? '.ts' : '.js'
const workerExecArgv = isTsx ? ['--import', 'tsx/esm'] : []

export class ParserOrchestrator extends EventEmitter {
  private run: ParserRun
  private workers = new Map<StepName, Worker>()
  private csvWriters = new Map<string, CsvWriter>()
  private deduplicator: LinkDeduplicator
  private outputDir: string
  private stopped = false
  private completionPromise!: Promise<void>
  private resolveCompletion!: () => void

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
    for (const url of initialUrls) {
      const task = this.run.addTask(url, this.config.entryStep, this.config.retryConfig)
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
    for (const [, worker] of this.workers) {
      worker.postMessage({ type: 'STOP' })
    }
    await this.closeAllWriters()
    this.resolveCompletion()
  }

  getStats(): RunStats {
    return this.run.getStats()
  }

  private spawnWorker(step: Step): void {
    const workerFile =
      step.type === 'traverser'
        ? resolve(__dirname, `../../infrastructure/worker/TraverserWorker${workerExt}`)
        : resolve(__dirname, `../../infrastructure/worker/ExtractorWorker${workerExt}`)

    // Pass plain serializable object (class instances lose methods via structured clone)
    const worker = new Worker(workerFile, {
      workerData: { step: { ...step } },
      execArgv: workerExecArgv,
    })

    worker.on('message', (msg: WorkerOutMessage) => this.handleWorkerMessage(msg))
    worker.on('error', (err) => this.emit('error', err))

    this.workers.set(step.name, worker)
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    switch (msg.type) {
      case 'LINKS_DISCOVERED': {
        const newLinks = this.deduplicator.filter(msg.links)
        for (const url of newLinks) {
          const task = this.run.addTask(
            url,
            msg.nextStep,
            this.config.retryConfig,
            msg.taskId,
            msg.parentData,
          )
          this.dispatchTask(task.id)
        }
        this.emit('stats', this.run.getStats())
        break
      }
      case 'DATA_EXTRACTED': {
        this.writeCsvRow(msg.outputFile, msg.data)
        break
      }
      case 'PAGE_SUCCESS': {
        this.run.markSuccess(msg.taskId)
        this.emit('stats', this.run.getStats())
        this.checkCompletion()
        break
      }
      case 'PAGE_FAILED': {
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
        break
      }
    }
  }

  private dispatchTask(taskId: string): void {
    if (this.stopped) return
    const task = this.run.getTask(taskId)
    if (!task) return
    const worker = this.workers.get(task.stepName)
    if (!worker) return
    worker.postMessage({ type: 'PROCESS_PAGE', task })
  }

  private writeCsvRow(outputFile: string, data: Record<string, string>): void {
    const filePath = resolve(this.outputDir, outputFile)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, new CsvWriter(filePath))
    }
    this.csvWriters.get(filePath)!.write(data).catch(console.error)
  }

  private async checkCompletion(): Promise<void> {
    if (this.stopped || !this.run.isComplete()) return
    await this.closeAllWriters()
    await this.runPostProcessing()
    this.emit('complete', this.run.getStats())
    this.resolveCompletion()
  }

  private async closeAllWriters(): Promise<void> {
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
