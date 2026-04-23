import type { Page } from 'playwright'
import type { PageTask } from '../../../domain/entities/PageTask.js'

const SUBCATEGORY_BLOCK = ['Collections', 'All', 'Registry']

export async function categoryStep(page: Page, task: PageTask) {
  const results: Array<{
    link: string
    page_type: string
    parent_data: Record<string, unknown>
  }> = []

  const { categoryLists, productTypeFilter, origin, currentUrl } = await page.evaluate(() => {
    const lists = Array.from(document.querySelectorAll("[data-component='category-list']")).map(
      (el) => {
        const h2 = el.querySelector('h2')
        const category = h2?.textContent?.trim() ?? ''
        const categoryHref = h2?.querySelector('a')?.getAttribute('href') ?? null

        const gridItems = Array.from(el.querySelectorAll("[data-style='grid-item'] a")).map(
          (a) => ({
            text: a.textContent?.trim() ?? '',
            href: (a as HTMLAnchorElement).getAttribute('href') ?? '',
          }),
        )

        return { category, categoryHref, gridItems }
      },
    )

    const productTypeFilter = Array.from(
      document.querySelectorAll('.accordion-item.collapsed'),
    ).some(
      (el) =>
        el.querySelector("[data-test-id='accordion-title'] h4")?.textContent?.trim() ===
        'Product Type',
    )

    return {
      categoryLists: lists,
      productTypeFilter,
      origin: window.location.origin,
      currentUrl: window.location.href,
    }
  })

  for (const { category, categoryHref, gridItems } of categoryLists) {
    if (categoryHref) {
      const link = `${origin}${categoryHref}`
      results.push({
        link,
        page_type: 'Subcategory',
        parent_data: { ...task.parentData, category, category_link: link },
      })
    } else {
      if (category.includes('Sale')) continue

      for (const { text: subcategory, href } of gridItems) {
        if (SUBCATEGORY_BLOCK.some((b) => subcategory.includes(b))) continue

        const q = href.split('/')[3]?.replace(/[^+]+\+/, '').replace(/^[^+]+\+/, '') ?? ''
        const link = `https://ac.cnstrc.com/browse/group_id/${q}?key=key_SQBuGmXjiXmP0UNI&offset=0&num_results_per_page=200`

        results.push({
          link,
          page_type: 'ProductList',
          parent_data: {
            ...task.parentData,
            category,
            subcategory,
            subcategory_link: `${origin}${href}`,
          },
        })
      }
    }
  }

  if (productTypeFilter) {
    results.push({
      link: currentUrl,
      page_type: 'Subcategory',
      parent_data: { ...task.parentData },
    })
  }

  if (!results.length) throw new Error('results are empty')

  return results
}
