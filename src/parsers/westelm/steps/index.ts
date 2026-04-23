import type { Page } from 'playwright'
import type { PageTask } from '../../../domain/entities/PageTask.js'

const BLOCK_LIST = ['Elm', 'New', 'Baby', 'Sale', 'Gifts']
const BLOCK_PATTERN = new RegExp(`\\b(?:${BLOCK_LIST.join('|')})s?\\b`)

export async function indexStep(page: Page, task: PageTask) {
  await page.screenshot({ path: '/tmp/westelm-debug.png', fullPage: false })
  console.log('page title:', await page.title())
  console.log('nav exists:', await page.$("ul[data-style='primary-nav']") !== null)

  await page.waitForSelector("ul[data-style='primary-nav']", { timeout: 15_000 })

  const items = await page.$$eval(
    "ul[data-style='primary-nav'] > li",
    (lis) =>
      lis.map((li) => {
        const anchor = li.querySelector('a')
        const text = anchor?.textContent?.trim() ?? ''
        const href = anchor?.getAttribute('href') ?? ''
        const origin = window.location.origin
        const link = href.startsWith('http') ? href : `${origin}${href}`
        return { text, link }
      }),
  )

  console.log(items)

  return items
    .filter(({ text }) => !BLOCK_PATTERN.test(text))
    .map(({ text, link }) => ({
      link,
      page_type: 'category',
      parent_data: {
        ...task.parentData,
        product_type: text,
        product_type_link: link,
      },
    }))
}
