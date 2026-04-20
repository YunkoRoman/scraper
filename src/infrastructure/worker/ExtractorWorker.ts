import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { BrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Extractor } from '../../domain/entities/Extractor.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

const { parserFilePath, stepName } = workerData as { parserFilePath: string; stepName: string }

let adapter: BrowserAdapter = createBrowserAdapter()
let running = true

async function processPage(task: PageTask, step: Extractor): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const rows = await step.run(page, task)
    parentPort!.postMessage({
      type: 'DATA_EXTRACTED',
      taskId: task.id,
      rows,
      outputFile: step.outputFile,
    } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

async function main() {
  const mod = (await import(parserFilePath)) as { default: ParserConfig }
  const config = mod.default
  const step = config.steps.get(stepName as StepName) as Extractor
  if (!step) throw new Error(`Step "${stepName}" not found in parser "${config.name}"`)

  adapter = createBrowserAdapter(step.settings?.browser_type)
  await adapter.launch()

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      await adapter.close()
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      await processPage(msg.task, step)
    }
  })
}

main().catch(console.error)
