import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { PlaywrightAdapter } from '../playwright/PlaywrightAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

// Plain object (class instance loses methods through structured clone)
interface TraverserData {
  name: StepName
  type: 'traverser'
  linkSelector: string
  nextStep: StepName | StepName[]
  parentDataSelectors?: Record<string, string>
  nextPageSelector?: string
}

const playwright = new PlaywrightAdapter()
let running = true

async function processPage(task: PageTask, step: TraverserData): Promise<void> {
  const page = await playwright.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const links = await page.$$eval(step.linkSelector, (els) =>
      els
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => href.startsWith('http')),
    )

    const parentData: Record<string, string> = {}
    if (step.parentDataSelectors) {
      for (const [key, selector] of Object.entries(step.parentDataSelectors)) {
        parentData[key] = (await page.$eval(selector, (el) => el.textContent ?? '').catch(() => ''))
      }
    }

    const nextSteps = Array.isArray(step.nextStep) ? step.nextStep : [step.nextStep]

    for (const nextStep of nextSteps) {
      const msg: WorkerOutMessage = {
        type: 'LINKS_DISCOVERED',
        taskId: task.id,
        links,
        nextStep,
        parentData: Object.keys(parentData).length > 0 ? parentData : undefined,
      }
      parentPort!.postMessage(msg)
    }

    if (step.nextPageSelector) {
      const nextUrl = await page
        .$eval(step.nextPageSelector, (el) => (el as HTMLAnchorElement).href)
        .catch(() => null)

      if (nextUrl && nextUrl !== task.url) {
        const paginationMsg: WorkerOutMessage = {
          type: 'LINKS_DISCOVERED',
          taskId: task.id,
          links: [nextUrl],
          nextStep: step.name,
        }
        parentPort!.postMessage(paginationMsg)
      }
    }

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
  const step: TraverserData = workerData.step
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
