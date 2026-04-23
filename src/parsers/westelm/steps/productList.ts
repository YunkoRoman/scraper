import type { Page } from 'playwright'
import type { PageTask } from '../../../domain/entities/PageTask.js'

interface ConstructorProduct {
  data: { id: string }
}

interface ConstructorResponse {
  response: { results: ConstructorProduct[] }
}

export async function productListStep(_page: Page, task: PageTask) {
  const res = await fetch(task.url)
  if (!res.ok) throw new Error(`Constructor API error: ${res.status}`)
  const json: ConstructorResponse = await res.json()

  const products = json.response.results
  const results: Array<{ link: string; page_type: string; parent_data: Record<string, unknown> }> =
    products.map((product) => ({
      link: `https://www.westelm.com/products/${product.data.id}`,
      page_type: 'Product',
      parent_data: { ...task.parentData },
    }))

  if (products.length === 200) {
    const nextUrl = task.url.replace(/offset=(\d+)/, (_, n) => `offset=${Number(n) + 200}`)
    results.push({ link: nextUrl, page_type: 'ProductList', parent_data: { ...task.parentData } })
  }

  return results
}
