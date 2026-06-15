import { Code, Section, SubSection, P, PageWrapper } from './shared'

export function RecipesPage() {
  return (
    <PageWrapper title="Recipes" description="Copy-paste patterns for common scraping tasks.">
      <Section title="Traverser — paginated list">
        <SubSection title="">
          <Code>
            {`// Collect all product links across pages
const results = []

const links = await page.$$eval('a.product-card', els =>
  els.map(el => el.href).filter(Boolean)
)
for (const link of links) {
  results.push({ link, page_type: 'Product', parent_data: task.parent_data })
}

// Follow pagination
const next = await page.$eval('a[rel="next"]', el => el.href).catch(() => null)
if (next) results.push({ link: next, page_type: 'ProductList', parent_data: task.parent_data })

return results`}
          </Code>
        </SubSection>
      </Section>

      <Section title="Extractor — product page">
        <SubSection title="">
          <Code>
            {`const get = (sel, attr) =>
  page.$(sel).then(el => el ? (attr ? el.getAttribute(attr) : el.textContent()) : null).catch(() => null)

const [title, price, sku, image] = await Promise.all([
  get('h1.product-title'),
  get('.price-current'),
  get('[data-sku]', 'data-sku'),
  get('img.product-image', 'src'),
])

return [{
  title: title?.trim(),
  price: price?.replace(/[^0-9.]/g, ''),
  sku,
  image,
  __url: task.url,
  ...task.parent_data,
}]`}
          </Code>
        </SubSection>
      </Section>

      <Section title="Helper file — shared validation">
        <SubSection title="">
          <P>
            Create a file named{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">validate</code> in the
            Files sidebar with reusable logic, then import it in any step.
          </P>
          <Code>
            {`// --- helper file: validate ---
export function parsePrice(raw: string | null): number | null {
  if (!raw) return null
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

export function requireFields(
  obj: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.every(f => obj[f] != null && obj[f] !== '')
}`}
          </Code>
          <Code>
            {`// --- extractor step code ---
import { parsePrice, requireFields } from './validate'

const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null)
const rawPrice = await page.$eval('.price', el => el.textContent).catch(() => null)

const row = {
  title,
  price: parsePrice(rawPrice),
  __url: task.url,
  ...task.parent_data,
}

if (!requireFields(row, ['title', 'price'])) {
  console.warn('Skipping incomplete row', task.url)
  return []
}

return [row]`}
          </Code>
        </SubSection>
      </Section>

      <Section title="Cloudflare bypass">
        <SubSection title="">
          <Code>
            {`// Detect CF block and solve on demand
const isCFBlock = await page.$('#challenge-error-text') !== null

if (isCFBlock) {
  const { response } = await solveCF(task.url, {
    disableMedia: true,
    waitInSeconds: 2,
  })
  await page.setContent(response)
}

// Continue scraping normally
const items = await page.$$eval('a.product', els => els.map(el => el.href))`}
          </Code>
        </SubSection>
      </Section>

      <Section title="Inject CF cookies into Playwright">
        <SubSection title="">
          <Code>
            {`// Get only cookies (faster — no HTML transfer)
const { cookies } = await solveCF(task.url, { returnOnlyCookies: true })

// Inject into Playwright context so subsequent navigations reuse them
await page.context().addCookies(
  cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: new URL(task.url).hostname,
    path: '/',
  }))
)

// Now reload normally — Playwright carries the CF clearance cookie
await page.reload({ waitUntil: 'domcontentloaded' })`}
          </Code>
        </SubSection>
      </Section>

      <Section title="Reuse solver session across pages">
        <SubSection title="">
          <Code>
            {`// Name a session so the solver browser stays warm across tasks
const SESSION = 'my-parser-session'

const { response } = await solveCF(task.url, {
  session: SESSION,
  session_ttl_minutes: 30,
})
await page.setContent(response)`}
          </Code>
        </SubSection>
      </Section>

      <Section title="Debug: disable headless locally">
        <SubSection title="">
          <P>Add to your parser's Browser Settings JSON to watch the browser while developing:</P>
          <Code>
            {`{
  "launchOptions": {
    "headless": false,
    "slowMo": 200
  }
}`}
          </Code>
        </SubSection>
      </Section>
    </PageWrapper>
  )
}
