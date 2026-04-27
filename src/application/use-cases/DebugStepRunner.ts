// src/application/use-cases/DebugStepRunner.ts
import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import type { IParserLoader } from '../../infrastructure/loader/IParserLoader.js'
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

  constructor(private readonly loader: IParserLoader) {
    super()
  }

  async run(
    parserName: string,
    stepName: string,
    url: string,
    parent_data?: Record<string, unknown>,
  ): Promise<void> {
    const config = await this.loader.load(parserName)
    const step = config.steps.get(stepName as StepName)
    if (!step) throw new Error(`Step "${stepName}" not found in parser "${parserName}"`)

    if (!config.filePath && !step.code) {
      throw new Error(`Step "${stepName}" has no filePath or code — cannot spawn worker`)
    }

    const task = createPageTask(url, stepName as StepName, step.type, config.retryConfig, undefined, parent_data)

    const bootstrapFile = resolve(__dirname, '../../infrastructure/worker/worker-bootstrap.js')
    const tsFile = step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
    const jsFile = step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')

    const entryFile = isTsx ? bootstrapFile : jsFile

    const workerData = config.filePath
      ? (isTsx
          ? { parserFilePath: config.filePath, stepName, __workerPath: tsFile, browserSettings: config.browserSettings }
          : { parserFilePath: config.filePath, stepName, browserSettings: config.browserSettings })
      : (isTsx
          ? {
              stepCode: step.code!,
              stepType: step.type,
              outputFile: step.type === 'extractor' ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile : undefined,
              stepSettings: step.settings,
              stepName,
              __workerPath: tsFile,
              browserSettings: config.browserSettings,
            }
          : {
              stepCode: step.code!,
              stepType: step.type,
              outputFile: step.type === 'extractor' ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile : undefined,
              stepSettings: step.settings,
              stepName,
              browserSettings: config.browserSettings,
            })

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
      this._cleanup()
    }
  }

  private _cleanup(): void {
    if (this.worker) {
      this.worker.terminate()
    }
    this.worker = null
    this.pendingReject = null
  }
}
