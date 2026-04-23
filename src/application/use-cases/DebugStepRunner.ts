// src/application/use-cases/DebugStepRunner.ts
import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { FileParserLoader } from '../../infrastructure/loader/FileParserLoader.js'
import { createPageTask } from '../../domain/entities/PageTask.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isTsx = __filename.endsWith('.ts')

export type DebugResult =
  | { type: 'links'; items: TraverserResult[] }
  | { type: 'data'; rows: Record<string, unknown>[]; outputFile: string }

export class DebugStepRunner extends EventEmitter {
  private worker: Worker | null = null
  private pendingReject: ((reason?: unknown) => void) | null = null

  constructor(private readonly loader: FileParserLoader) {
    super()
  }

  async run(
    parserName: string,
    stepName: string,
    url: string,
    parentData?: Record<string, unknown>,
  ): Promise<void> {
    const config = await this.loader.load(parserName)
    const step = config.steps.get(stepName as StepName)
    if (!step) throw new Error(`Step "${stepName}" not found in parser "${parserName}"`)
    if (!config.filePath) throw new Error('filePath missing — use FileParserLoader')

    const task = createPageTask(url, stepName as StepName, step.type, config.retryConfig, undefined, parentData)

    const bootstrapFile = resolve(__dirname, '../../infrastructure/worker/worker-bootstrap.js')
    const tsFile = step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
    const jsFile = step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')

    const entryFile = isTsx ? bootstrapFile : jsFile
    const workerData = isTsx
      ? { parserFilePath: config.filePath, stepName, __workerPath: tsFile, browserSettings: config.browserSettings }
      : { parserFilePath: config.filePath, stepName, browserSettings: config.browserSettings }

    return new Promise((resolve, reject) => {
      this.pendingReject = reject
      const worker = new Worker(entryFile, { workerData })
      this.worker = worker

      worker.on('message', (msg: WorkerOutMessage) => {
        switch (msg.type) {
          case 'LOG':
            this.emit('log', { level: msg.level, stepName: msg.stepName, args: msg.args })
            break
          case 'LINKS_DISCOVERED':
            this.emit('result', { type: 'links', items: msg.items } satisfies DebugResult)
            break
          case 'DATA_EXTRACTED':
            this.emit('result', { type: 'data', rows: msg.rows, outputFile: msg.outputFile } satisfies DebugResult)
            break
          case 'PAGE_SUCCESS':
            this._cleanup()
            resolve()
            break
          case 'PAGE_FAILED':
            this._cleanup()
            reject(msg.error)
            break
        }
      })

      worker.on('error', (err) => {
        this._cleanup()
        reject(err)
      })

      worker.on('exit', (code) => {
        if (code !== 0 && this.pendingReject) {
          this._cleanup()
          reject(new Error(`Worker exited with code ${code}`))
        }
      })

      worker.postMessage({ type: 'PROCESS_PAGE', task })
    })
  }

  stop(): void {
    if (this.worker) {
      this.pendingReject?.(new Error('aborted'))
      this.worker.terminate()
      this._cleanup()
    }
  }

  private _cleanup(): void {
    this.worker = null
    this.pendingReject = null
  }
}
