import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { pipeConsole } from './pipeConsole.js'
import { buildContextOptions } from './buildContextOptions.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { BrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Traverser } from '../../domain/entities/Traverser.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

const { parserFilePath, stepName, browserSettings } = workerData as {
  parserFilePath: string
  stepName: string
  browserSettings?: Pick<StepSettings, 'browser_type' | 'launchOptions' | 'contextOptions' | 'initScripts' | 'userAgent' | 'proxySettings'>
}
pipeConsole(stepName)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: BrowserAdapter<any> = createBrowserAdapter()
let running = true
let concurrency = 3
let activeCount = 0
const queue: PageTask[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processPage(task: PageTask, step: Traverser<any>): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const items = await step.run(page, task)
    parentPort!.postMessage({ type: 'LINKS_DISCOVERED', taskId: task.id, items } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    console.error(`[FAIL] ${task.url}\n`, err)
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drainQueue(step: Traverser<any>): void {
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
function enqueue(task: PageTask, step: Traverser<any>): void {
  queue.push(task)
  drainQueue(step)
}

async function main() {
  const mod = (await import(parserFilePath)) as { default: ParserConfig }
  const config = mod.default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step = config.steps.get(stepName as StepName) as Traverser<any>
  if (!step) throw new Error(`Step "${stepName}" not found in parser "${config.name}"`)

  const mergedSettings: StepSettings = {
    ...browserSettings,
    ...step.settings,
    contextOptions: buildContextOptions(browserSettings, step.settings),
    initScripts: [...(browserSettings?.initScripts ?? []), ...(step.settings?.initScripts ?? [])],
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
