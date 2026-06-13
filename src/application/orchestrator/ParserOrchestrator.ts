import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Step } from '../../domain/entities/Step.js'
import { LinkDeduplicator } from '../../domain/services/LinkDeduplicator.js'
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
import {
  createOutputWriter,
  resolveOutputFileName,
  type OutputWriter,
  type OutputFormat,
} from '../../infrastructure/export/OutputWriter.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { TaskStateStore } from '../../domain/services/TaskStateStore.js'
import { mkdir } from 'node:fs/promises'
import { PageState, isTerminal } from '../../domain/value-objects/PageState.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isTsx = __filename.endsWith('.ts')

export class ParserOrchestrator extends EventEmitter {
  private workers = new Map<StepName, Worker>()
  private csvWriters = new Map<string, OutputWriter>()
  private pendingWrites: Promise<void>[] = []
  private deduplicator: LinkDeduplicator
  private outputDir: string
  private stopped = false
  private completing = false
  private completionPromise!: Promise<void>
  private resolveCompletion!: () => void
  private globalActive = 0
  private dispatchQueue: string[] = []
  private taskHtml = new Map<string, string>()
  private activeTaskIds = new Set<string>()
  private retryingTasks = new Set<string>()

  constructor(
    private readonly config: ParserConfig,
    outputBaseDir: string,
    private readonly store: TaskStateStore,
    private readonly runId_: string,
    snapshotTasks?: PageTask[],
  ) {
    super()
    if (snapshotTasks) {
      for (const t of snapshotTasks) void this.store.restoreTask(t)
    }
    this.deduplicator = new LinkDeduplicator(config.deduplication)
    this.outputDir = resolve(outputBaseDir, config.name, this.runId_)
  }

  get runId(): string {
    return this.runId_
  }

  async getAllTasks(): Promise<PageTask[]> {
    return this.store.allTasks()
  }

  async retryTask(taskId: string): Promise<void> {
    if (this.retryingTasks.has(taskId)) {
      throw new Error(`Task "${taskId}" is already being retried`)
    }
    this.retryingTasks.add(taskId)
    try {
      const task = await this.store.getTask(taskId)
      if (!task) throw new Error(`Task "${taskId}" not found`)
      if (task.state !== PageState.Failed && task.state !== PageState.Aborted) {
        throw new Error(`Task "${taskId}" is not failed or aborted (state: ${task.state})`)
      }
      await this.store.markPending(taskId)
      await this.dispatchTask(taskId)
    } finally {
      this.retryingTasks.delete(taskId)
    }
  }

  async abortTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (
      task.state !== PageState.Pending &&
      task.state !== PageState.InProgress &&
      task.state !== PageState.Retry
    ) {
      throw new Error(`Task "${taskId}" cannot be aborted (state: ${task.state})`)
    }
    await this.store.markAborted(taskId)
  }

  async start(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })
    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve
    })

    for (const [, step] of this.config.steps) this.spawnWorker(step)

    const snapshotTasks = await this.store.allTasks()
    if (snapshotTasks.length > 0) {
      // Warm the cache so subsequent getTask() calls don't round-trip to DB per task.
      for (const t of snapshotTasks) await this.store.restoreTask(t)
      const successUrls = snapshotTasks
        .filter((t) => t.state === PageState.Success)
        .map((t) => t.url)
      this.deduplicator.seed(successUrls)
      const toDispatch = snapshotTasks.filter(
        (t) =>
          t.state === PageState.Aborted ||
          t.state === PageState.Pending ||
          t.state === PageState.Retry,
      )
      for (const task of toDispatch) {
        await this.store.markPending(task.id)
        await this.dispatchTask(task.id)
      }
    } else {
      if (!/^https?:\/\//i.test(this.config.entryUrl)) {
        throw new Error('Invalid entryUrl: must start with http:// or https://')
      }
      const initialUrls = this.deduplicator.filter([this.config.entryUrl])
      const entryStepType = this.config.steps.get(this.config.entryStep)?.type ?? 'traverser'
      for (const url of initialUrls) {
        const task = await this.store.addTask(
          url,
          this.config.entryStep,
          entryStepType,
          this.config.retryConfig,
        )
        await this.dispatchTask(task.id)
      }
    }

    this.emit('stats', await this.store.getStats())
    return this.completionPromise
  }

  async stop(): Promise<void> {
    this.stopped = true
    const tasks = await this.store.allTasks()
    for (const task of tasks) {
      if (
        task.state === PageState.Pending ||
        task.state === PageState.Retry ||
        task.state === PageState.InProgress
      ) {
        await this.store.markAborted(task.id)
      }
    }
    const exitPromises = [...this.workers.values()].map(
      (worker) =>
        new Promise<void>((resolve) => {
          worker.once('exit', () => resolve())
          worker.postMessage({ type: 'STOP' })
          setTimeout(
            () =>
              worker
                .terminate()
                .then(() => resolve())
                .catch(() => resolve()),
            5_000,
          )
        }),
    )
    await Promise.all(exitPromises)
    if (!this.completing) {
      this.completing = true
      await this.closeAllWriters()
    }
    this.resolveCompletion()
  }

  async getStats(): Promise<RunStats> {
    return this.store.getStats()
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
      ? isTsx
        ? {
            parserFilePath: this.config.filePath!,
            stepName: String(step.name),
            __workerPath: tsWorkerFile,
            browserSettings: this.config.browserSettings,
          }
        : {
            parserFilePath: this.config.filePath!,
            stepName: String(step.name),
            browserSettings: this.config.browserSettings,
          }
      : isTsx
        ? {
            stepCode: step.code!,
            stepType: step.type,
            outputFile,
            stepSettings: step.settings,
            stepName: String(step.name),
            __workerPath: tsWorkerFile,
            browserSettings: this.config.browserSettings,
          }
        : {
            stepCode: step.code!,
            stepType: step.type,
            outputFile,
            stepSettings: step.settings,
            stepName: String(step.name),
            browserSettings: this.config.browserSettings,
          }

    const worker = new Worker(entryFile, {
      workerData: wData,
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 128 },
    })
    worker.on('message', (msg: WorkerOutMessage) => {
      this.handleWorkerMessage(msg).catch((err) =>
        console.error('[orchestrator] handler failed', err),
      )
    })
    worker.on('error', (err) => {
      this.emit('error', err)
      void (async () => {
        const tasks = await this.store.allTasks()
        for (const task of tasks) {
          if (String(task.stepName) === String(step.name) && task.state === PageState.InProgress) {
            if (this.activeTaskIds.delete(task.id)) {
              this.globalActive--
            }
            const failed = await this.store.markFailed(task.id, `Worker crashed: ${err.message}`)
            this.emit('task_done', failed)
          }
        }
        this.emit('stats', await this.store.getStats())
        await this.flushDispatchQueue()
        this.checkCompletion()
      })()
    })
    this.workers.set(step.name, worker)
  }

  private async handleWorkerMessage(msg: WorkerOutMessage): Promise<void> {
    switch (msg.type) {
      case 'LINKS_DISCOVERED': {
        if (this.stopped) break
        const validItems = msg.items.filter((i) => /^https?:\/\//i.test(i.link))
        const newLinks = new Set(this.deduplicator.filter(validItems.map((i) => i.link)))
        const newItems = validItems.filter((i) => newLinks.has(i.link))
        for (const item of newItems) {
          const sName = item.page_type as StepName
          const stepType = this.config.steps.get(sName)?.type ?? 'traverser'
          const task = await this.store.addTask(
            item.link,
            sName,
            stepType,
            this.config.retryConfig,
            msg.taskId,
            item.parent_data,
          )
          await this.dispatchTask(task.id)
        }
        this.emit('stats', await this.store.getStats())
        break
      }
      case 'DATA_EXTRACTED': {
        for (const row of msg.rows) this.writeOutputRow(msg.outputFile, row)
        const task = await this.store.getTask(msg.taskId)
        this.emit('data_extracted', { taskId: msg.taskId, rows: msg.rows, task })
        break
      }
      case 'PAGE_SUCCESS': {
        if (this.activeTaskIds.delete(msg.taskId)) {
          this.globalActive--
        }
        const task = await this.store.getTask(msg.taskId)
        if (!task || isTerminal(task.state)) {
          await this.flushDispatchQueue()
          this.checkCompletion()
          break
        }
        const updated = await this.store.markSuccess(msg.taskId)
        this.emit('task_done', updated)
        this.emit('stats', await this.store.getStats())
        await this.flushDispatchQueue()
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
        if (this.activeTaskIds.delete(msg.taskId)) {
          this.globalActive--
        }
        if (msg.html) this.taskHtml.set(msg.taskId, msg.html)
        const task = await this.store.getTask(msg.taskId)
        if (!task || isTerminal(task.state)) {
          this.taskHtml.delete(msg.taskId)
          await this.flushDispatchQueue()
          this.checkCompletion()
          break
        }
        if (task.attempts < task.maxAttempts) {
          await this.store.markRetry(msg.taskId, msg.error)
          this.emit('stats', await this.store.getStats())
          await this.dispatchTask(msg.taskId)
        } else {
          const updated = await this.store.markFailed(msg.taskId, msg.error)
          const html = this.taskHtml.get(msg.taskId)
          if (html) {
            this.emit('task_failed_html', msg.taskId, html)
            this.taskHtml.delete(msg.taskId)
          }
          this.emit('task_done', updated)
          this.emit('stats', await this.store.getStats())
          this.checkCompletion()
        }
        await this.flushDispatchQueue()
        break
      }
      default: {
        const _exhaustive: never = msg
        console.error(
          '[orchestrator] unhandled worker message type:',
          (_exhaustive as WorkerOutMessage).type,
        )
        break
      }
    }
  }

  private async dispatchTask(taskId: string): Promise<void> {
    if (this.stopped) return
    const quota = this.config.concurrentQuota
    if (quota !== undefined && this.globalActive >= quota) {
      this.dispatchQueue.push(taskId)
      return
    }
    this.globalActive++
    this.activeTaskIds.add(taskId)
    await this._sendToWorker(taskId)
  }

  private async _sendToWorker(taskId: string): Promise<void> {
    // globalActive and activeTaskIds are already claimed by the caller (dispatchTask or flushDispatchQueue).
    const task = await this.store.getTask(taskId)
    if (!task || isTerminal(task.state)) {
      this.globalActive--
      this.activeTaskIds.delete(taskId)
      return
    }
    if (this.stopped) {
      this.globalActive--
      this.activeTaskIds.delete(taskId)
      return
    }
    const worker = this.workers.get(task.stepName)
    if (!worker) {
      this.globalActive--
      this.activeTaskIds.delete(taskId)
      const failed = await this.store.markFailed(taskId, `No worker for step "${task.stepName}"`)
      this.emit('task_done', failed)
      this.emit('stats', await this.store.getStats())
      this.checkCompletion()
      return
    }
    let inProgress: PageTask
    try {
      inProgress = await this.store.markInProgress(taskId)
    } catch (err) {
      this.globalActive--
      this.activeTaskIds.delete(taskId)
      throw err
    }
    if (this.stopped) {
      this.globalActive--
      this.activeTaskIds.delete(taskId)
      return
    }
    worker.postMessage({ type: 'PROCESS_PAGE', task: inProgress })
  }

  private async flushDispatchQueue(): Promise<void> {
    const quota = this.config.concurrentQuota
    while (this.dispatchQueue.length > 0 && (quota === undefined || this.globalActive < quota)) {
      const nextId = this.dispatchQueue.shift()!
      this.globalActive++
      this.activeTaskIds.add(nextId)
      await this._sendToWorker(nextId)
    }
  }

  private checkCompletion(): void {
    if (this.stopped || this.completing) return
    this.completing = true
    void (async () => {
      if (!(await this.store.isComplete())) {
        this.completing = false
        return
      }
      try {
        await this.closeAllWriters()
        await this.runPostProcessing()
        this.emit('complete', await this.store.getStats())
        this.resolveCompletion()
      } catch (err) {
        this.emit('error', err)
      }
    })()
  }

  private writeOutputRow(outputFile: string, data: Record<string, unknown>): void {
    let format: OutputFormat = 'csv'
    for (const [, step] of this.config.steps) {
      const stepOutputFile = (step as { outputFile?: string }).outputFile
      if (stepOutputFile === outputFile && step.settings?.outputFormat) {
        format = step.settings.outputFormat as OutputFormat
        break
      }
    }
    const resolvedFile = resolveOutputFileName(outputFile, format)
    const filePath = resolve(this.outputDir, resolvedFile)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, createOutputWriter(format, filePath))
    }
    const p = this.csvWriters.get(filePath)!.write(data).catch(console.error) as Promise<void>
    this.pendingWrites.push(p)
  }

  private async closeAllWriters(): Promise<void> {
    const toFlush = [...this.pendingWrites]
    this.pendingWrites = []
    await Promise.all(toFlush)
    await Promise.all([...this.csvWriters.values()].map((w) => w.close()))
  }

  private async runPostProcessing(): Promise<void> {
    for (const [filePath] of this.csvWriters) {
      if (!filePath.endsWith('.csv')) {
        this.emit('postprocess', filePath)
        continue
      }
      const processor = new CsvPostProcessor(filePath)
      await processor.process()
      this.emit('postprocess', filePath)
    }
  }
}
