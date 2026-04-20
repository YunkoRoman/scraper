import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'bauer',
  entryUrl: 'https://www.bauer.com/products/bauer-vapor-flylite-skate-juinor',
  retryConfig: { maxRetries: 3 },
  deduplication: false,
  steps: {
    product: {
      type: 'extractor',
      outputFile: 'bauer-headings.csv',
      run: async (page: Page, task: PageTask) => {
        const h1 = await page.$eval('h1', (el) => el.textContent?.trim() ?? '').catch(() => '')
        return [{ h1, __url: task.url }]
      },
    },
  },
})
