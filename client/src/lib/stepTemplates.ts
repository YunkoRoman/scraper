export interface StepTemplate {
  label: string
  type: 'traverser' | 'extractor'
  code: string
}

export const STEP_TEMPLATES: StepTemplate[] = [
  {
    label: 'Pagination Traverser',
    type: 'traverser',
    code: `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
const links = await page.$$eval('a.product-link', els => els.map(el => el.href))
const next  = await page.$eval('a.next-page', el => el.href).catch(() => null)
const out = links.map(link => ({ link, page_type: 'product', parent_data: {} }))
if (next) out.push({ link: next, page_type: 'pagination', parent_data: {} })
return out`,
  },
  {
    label: 'Category List Traverser',
    type: 'traverser',
    code: `const cats = await page.$$eval('nav.categories a', els =>
  els.map(el => ({ href: el.href, name: el.textContent?.trim() ?? '' }))
)
return cats.map(c => ({ link: c.href, page_type: 'category', parent_data: { categoryName: c.name } }))`,
  },
  {
    label: 'REST API Extractor',
    type: 'extractor',
    code: `const data = await page.evaluate(async (url) => {
  const r = await fetch(url, { credentials: 'include' })
  return r.json()
}, task.url)
return Array.isArray(data) ? data : [data]`,
  },
  {
    label: 'Product Detail Extractor',
    type: 'extractor',
    code: `const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
const price = await page.$eval('.price', el => el.textContent?.trim() ?? '').catch(() => '')
const desc  = await page.$eval('.description', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, price, desc, __url: task.url, ...(task.parent_data ?? {}) }]`,
  },
  {
    label: 'Infinite Scroll Traverser',
    type: 'traverser',
    code: `let prevCount = -1
for (let i = 0; i < 30; i++) {
  const count = await page.$$eval('.item', els => els.length)
  if (count === prevCount) break
  prevCount = count
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(800)
}
const links = await page.$$eval('.item a', els => els.map(el => el.href))
return links.map(link => ({ link, page_type: 'detail', parent_data: {} }))`,
  },
]
