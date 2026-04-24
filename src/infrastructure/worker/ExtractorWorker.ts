// src/infrastructure/worker/ExtractorWorker.ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage, WorkerData } from './messages.js'
import { pipeConsole } from './pipeConsole.js'
import { buildContextOptions } from './buildContextOptions.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { BrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Extractor } from '../../domain/entities/Extractor.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import { stepName } from '../../domain/value-objects/StepName.js'

const data = workerData as WorkerData
pipeConsole(data.stepName)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: any[]) => Promise<any>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: BrowserAdapter<any> = createBrowserAdapter()
let running = true
let concurrency = 3
let activeCount = 0
const queue: PageTask[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processPage(task: PageTask, step: Extractor<any>): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const rows = await step.run(page, task)
    parentPort!.postMessage({ type: 'DATA_EXTRACTED', taskId: task.id, rows, outputFile: step.outputFile } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    console.error(`[FAIL] ${task.url}\n`, err)
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drainQueue(step: Extractor<any>): void {
  while (queue.length > 0 && activeCount < concurrency) {
    const task = queue.shift()!
    activeCount++
    processPage(task, step).finally(() => {
      activeCount--
      drainQueue(step)
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enqueue(task: PageTask, step: Extractor<any>): void {
  queue.push(task)
  drainQueue(step)
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let step: Extractor<any>
  let stepSettings: StepSettings | undefined

  if ('parserFilePath' in data) {
    const mod = (await import(data.parserFilePath)) as { default: ParserConfig }
    const config = mod.default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    step = config.steps.get(data.stepName as StepName) as Extractor<any>
    if (!step) throw new Error(`Step "${data.stepName}" not found in parser "${config.name}"`)
    stepSettings = step.settings
  } else {
    const run = new AsyncFunction('page', 'task', data.stepCode)
    const { Extractor: E } = await import('../../domain/entities/Extractor.js')
    const outFile = data.outputFile ?? `${data.stepName}.csv`
    step = new E(stepName(data.stepName), run, outFile, data.stepSettings)
    stepSettings = data.stepSettings
  }

  const mergedSettings: StepSettings = {
    ...data.browserSettings,
    ...stepSettings,
    contextOptions: buildContextOptions(data.browserSettings, stepSettings),
    initScripts: [...(data.browserSettings?.initScripts ?? []), ...(stepSettings?.initScripts ?? [])],
  }
  concurrency = mergedSettings.concurrency ?? 3
  adapter = createBrowserAdapter(mergedSettings.browser_type, mergedSettings)
  await adapter.launch()
  if (mergedSettings.initScripts?.length) {
    const pa = adapter as import('../browser/PlaywrightAdapter.js').PlaywrightAdapter
    for (const script of mergedSettings.initScripts) {
      await pa.addInitScript(script)
    }
  }

  parentPort!.on('message', (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      adapter.close().catch(console.error)
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      enqueue(msg.task, step)
    }
  })
}

main().catch(console.error)
