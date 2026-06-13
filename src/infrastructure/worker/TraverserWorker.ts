// src/infrastructure/worker/TraverserWorker.ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage, WorkerData } from './messages.js'
import { pipeConsole } from './pipeConsole.js'
import { mergeWorkerSettings } from './mergeWorkerSettings.js'
import { ProxyPoolService } from '../proxy/ProxyPoolService.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { BrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Traverser } from '../../domain/entities/Traverser.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import { stepName } from '../../domain/value-objects/StepName.js'
import { makeSolveCFSnippet } from '../flaresolverr/FlareSolverrService.js'

const data = workerData as WorkerData
pipeConsole(data.stepName)

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...a: any[]) => Promise<any>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: BrowserAdapter<any> = createBrowserAdapter()
let proxyPool: ProxyPoolService = new ProxyPoolService([])
let running = true
let concurrency = 3
let pageDelayMin = 0
let pageDelayMax = 0
let maxPagesPerContext = 0
let pagesProcessed = 0
let rotating = false
let needsRotation = false
let contextKilledCount = 0
let activeCount = 0
const queue: PageTask[] = []
let savedSettings: StepSettings = {}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rotateAdapter(): Promise<void> {
  console.log('[worker] Rotating browser context…')
  await adapter.close().catch(console.error)
  const proxyUrl = proxyPool.next()
  const settingsForLaunch = proxyUrl
    ? {
        ...savedSettings,
        contextOptions: { ...(savedSettings.contextOptions ?? {}), proxy: { server: proxyUrl } },
      }
    : savedSettings
  adapter = createBrowserAdapter(savedSettings.browser_type, settingsForLaunch)
  await adapter.launch()
  if (savedSettings.initScripts?.length) {
    for (const script of savedSettings.initScripts) {
      await adapter.addInitScript(script)
    }
  }
  if (proxyUrl)
    console.log(`[worker] Rotated to proxy: ${proxyUrl.replace(/:\/\/[^@]*@/, '://***@')}`)
  else console.log('[worker] Browser context rotated.')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processPage(task: PageTask, step: Traverser<any>): Promise<boolean> {
  if (pageDelayMin > 0 || pageDelayMax > 0) {
    await randomDelay(pageDelayMin, Math.max(pageDelayMin, pageDelayMax))
  }

  const page = await adapter.newPage()

  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const items = await step.run(page, task)
    parentPort!.postMessage({
      type: 'LINKS_DISCOVERED',
      taskId: task.id,
      items,
    } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
    return true
  } catch (err) {
    console.error(`[FAIL] ${task.url}\n`, err)
    const html = await page.content().catch(() => undefined)
    parentPort!.postMessage({
      type: 'PAGE_FAILED',
      taskId: task.id,
      error: String(err),
      html,
    } satisfies WorkerOutMessage)
    return false
  } finally {
    await page.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drainQueue(step: Traverser<any>): void {
  if (rotating) return
  // Failure rotation: immediate — kills any in-flight pages (they will fail but don't re-trigger rotation)
  if (needsRotation) {
    rotating = true
    needsRotation = false
    contextKilledCount = activeCount
    rotateAdapter()
      .then(() => {
        pagesProcessed = 0
        rotating = false
        drainQueue(step)
      })
      .catch(console.error)
    return
  }
  // Quota rotation: wait for in-flight pages to finish cleanly
  if (maxPagesPerContext > 0 && pagesProcessed >= maxPagesPerContext && activeCount === 0) {
    rotating = true
    rotateAdapter()
      .then(() => {
        pagesProcessed = 0
        rotating = false
        drainQueue(step)
      })
      .catch(console.error)
    return
  }
  while (queue.length > 0 && activeCount < concurrency) {
    const task = queue.shift()!
    activeCount++
    processPage(task, step).then((success) => {
      pagesProcessed++
      if (!success) {
        if (contextKilledCount > 0) contextKilledCount--
        else needsRotation = true
      }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let step: Traverser<any>
  let stepSettings: StepSettings | undefined

  if ('parserFilePath' in data) {
    const mod = (await import(data.parserFilePath)) as { default: ParserConfig }
    const config = mod.default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    step = config.steps.get(data.stepName as StepName) as Traverser<any>
    if (!step) throw new Error(`Step "${data.stepName}" not found in parser "${config.name}"`)
    stepSettings = step.settings
  } else {
    const solveCFSnippet = makeSolveCFSnippet(process.env.FLARESOLVERR_URL ?? '')
    const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + data.stepCode)
    const { Traverser: T } = await import('../../domain/entities/Traverser.js')
    step = new T(stepName(data.stepName), run, data.stepSettings)
    stepSettings = data.stepSettings
  }

  const mergedSettings: StepSettings = mergeWorkerSettings(data.browserSettings, stepSettings)
  concurrency = mergedSettings.concurrency ?? 3
  pageDelayMin = mergedSettings.pageDelayMin ?? 0
  pageDelayMax = mergedSettings.pageDelayMax ?? 0
  maxPagesPerContext = mergedSettings.maxPagesPerContext ?? 0
  savedSettings = mergedSettings
  proxyPool = new ProxyPoolService((mergedSettings as { proxyPool?: string[] }).proxyPool ?? [])
  const firstProxy = proxyPool.next()
  const initialSettings = firstProxy
    ? {
        ...mergedSettings,
        contextOptions: { ...(mergedSettings.contextOptions ?? {}), proxy: { server: firstProxy } },
      }
    : mergedSettings
  adapter = createBrowserAdapter(mergedSettings.browser_type, initialSettings)
  await adapter.launch()
  if (mergedSettings.initScripts?.length) {
    for (const script of mergedSettings.initScripts) {
      await adapter.addInitScript(script)
    }
  }

  parentPort!.on('message', (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      adapter.close().catch(console.error)
      return
    }
    if (msg.type === 'PROCESS_PAGE') {
      if (running) {
        enqueue(msg.task, step)
      } else {
        parentPort!.postMessage({
          type: 'PAGE_FAILED',
          taskId: msg.task.id,
          error: 'Worker is shutting down',
        })
      }
    }
  })
}

main().catch(console.error)
