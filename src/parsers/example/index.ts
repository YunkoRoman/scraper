import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'example',
  entryUrl: 'https://books.toscrape.com/',
  entryStep: 'categoryList',
  retryConfig: { maxRetries: 3 },
  deduplication: true,
  steps: {
    categoryList: {
      type: 'traverser',
      run: async (page: Page, task: PageTask) => {
        const items = await page.$$eval('div.side_categories ul li ul li a', (els) =>
          els.map((el) => ({
            link: (el as HTMLAnchorElement).href,
            category: el.textContent?.trim() ?? '',
          })),
        )
        return items.map(({ link, category }) => ({
          link,
          page_type: 'bookList',
          parent_data: { ...task.parentData, category },
        }))
      },
    },
    bookList: {
      type: 'traverser',
      run: async (page: Page, task: PageTask) => {
        const bookLinks = await page.$$eval('article.product_pod h3 a', (els) =>
          els.map((el) => (el as HTMLAnchorElement).href),
        )
        const nextPage = await page
          .$eval('li.next a', (el) => (el as HTMLAnchorElement).href)
          .catch(() => null)

        const results = bookLinks.map((link) => ({
          link,
          page_type: 'bookDetail',
          parent_data: { ...task.parentData },
        }))

        if (nextPage && nextPage !== task.url) {
          results.push({ link: nextPage, page_type: 'bookList', parent_data: { ...task.parentData } })
        }

        return results
      },
    },
    bookDetail: {
      type: 'extractor',
      outputFile: 'books.csv',
      run: async (page: Page, task: PageTask) => {
        const title = await page.$eval('h1', (el) => el.textContent?.trim() ?? '').catch(() => '')
        const price = await page
          .$eval('p.price_color', (el) => el.textContent?.trim() ?? '')
          .catch(() => '')
        const availability = await page
          .$eval('p.availability', (el) => el.textContent?.trim() ?? '')
          .catch(() => '')
        const rating = await page
          .$eval('p.star-rating', (el) => el.className.replace('star-rating ', '') ?? '')
          .catch(() => '')
        return [
          {
            title,
            price,
            availability,
            rating,
            category: String(task.parentData?.category ?? ''),
            __url: task.url,
          },
        ]
      },
    },
  },
})
