import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { PlaywrightAdapter } from '../playwright/PlaywrightAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

// Plain object (class instance loses methods through structured clone)
interface ExtractorData {
  name: StepName
  type: 'extractor'
  dataSelectors: Record<string, string>
  outputFile: string
}

const playwright = new PlaywrightAdapter()
let running = true

async function processPage(task: PageTask, step: ExtractorData): Promise<void> {
  const page = await playwright.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const data: Record<string, string> = {}

    if (task.parentData) {
      Object.assign(data, task.parentData)
    }

    for (const [key, selector] of Object.entries(step.dataSelectors)) {
      data[key] = await page
        .$eval(selector, (el) => el.textContent?.trim() ?? '')
        .catch(() => '')
    }

    data['__url'] = task.url

    const extractMsg: WorkerOutMessage = {
      type: 'DATA_EXTRACTED',
      taskId: task.id,
      data,
      outputFile: step.outputFile,
    }
    parentPort!.postMessage(extractMsg)

    const successMsg: WorkerOutMessage = { type: 'PAGE_SUCCESS', taskId: task.id }
    parentPort!.postMessage(successMsg)
  } catch (err) {
    const failMsg: WorkerOutMessage = {
      type: 'PAGE_FAILED',
      taskId: task.id,
      error: String(err),
    }
    parentPort!.postMessage(failMsg)
  } finally {
    await page.close()
  }
}

async function main() {
  const step: ExtractorData = workerData.step
  await playwright.launch()

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      await playwright.close()
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      await processPage(msg.task, step)
    }
  })
}

main().catch(console.error)
