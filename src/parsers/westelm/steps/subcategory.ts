import type { Page } from 'playwright'
import type { PageTask } from '../../../domain/entities/PageTask.js'

const API_KEY = 'key_SQBuGmXjiXmP0UNI'

interface ConstructorFacetOption {
  display_name: string
  value: string
}

interface ConstructorResponse {
  response: {
    facets: Array<{ name: string; options: ConstructorFacetOption[] }>
  }
}

function encodeFilterValue(value: string) {
  return value.replaceAll(' & ', '%20%26%20')
}

function buildFilterLink(q: string, filterName: string, value: string) {
  return `https://ac.cnstrc.com/browse/group_id/${q}?key=${API_KEY}&offset=0&num_results_per_page=200&filters%5B${filterName}%5D=${encodeFilterValue(value)}`
}

export async function subcategoryStep(_page: Page, task: PageTask) {
  const { index_attrs, product_type, product_type_link, category, category_link } =
    (task.parentData ?? {}) as Record<string, string | null | undefined>

  const q = new URL(task.url).pathname.split('/')[3]
  const apiUrl = `https://ac.cnstrc.com/browse/group_id/${q}?key=${API_KEY}&offset=0&num_results_per_page=100`

  const res = await fetch(apiUrl)
  if (!res.ok) throw new Error(`Constructor API error: ${res.status}`)
  const data: ConstructorResponse = await res.json()

  const results: Array<{
    link: string
    page_type: string
    parent_data: Record<string, unknown>
  }> = []

  const productTypeFilter = data.response.facets.find((f) => f.name === 'productType')?.options
  const collectionFilter = data.response.facets.find((f) => f.name === 'collection')?.options

  for (const facetOptions of [
    { options: productTypeFilter, filterName: 'productType' },
    { options: collectionFilter, filterName: 'collection' },
  ]) {
    if (!facetOptions.options?.length) continue

    for (const { display_name: name, value } of facetOptions.options) {
      results.push({
        link: buildFilterLink(q, facetOptions.filterName, value),
        page_type: 'ProductList',
        parent_data: {
          index_attrs,
          product_type,
          product_type_link,
          category: category ?? name,
          category_link: category ?? null,
          subcategory: category ? name : null,
        },
      })
    }
  }

  return results
}
