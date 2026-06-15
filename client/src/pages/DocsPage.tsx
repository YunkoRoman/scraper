import { useEffect, useRef, useState } from 'react'

// ─── Code block ──────────────────────────────────────────────────────────────
function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="relative group my-3">
      <pre className="bg-gray-900 dark:bg-black border border-gray-700 dark:border-gray-800 rounded-lg p-4 overflow-x-auto text-[13px] leading-relaxed text-gray-200 dark:text-gray-300 font-mono">
        {children.trim()}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2.5 right-2.5 px-2 py-1 text-[11px] rounded bg-gray-700 dark:bg-gray-800 text-gray-300 dark:text-gray-400 hover:text-white hover:bg-gray-600 dark:hover:bg-gray-700 transition-all opacity-0 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  string:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800/50',
  number:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800/50',
  boolean:
    'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800/50',
  object:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800/50',
  array:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800/50',
  enum: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800/50',
}

function Badge({ type }: { type: string }) {
  const cls =
    TYPE_COLORS[type] ??
    'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono border ${cls}`}
    >
      {type}
    </span>
  )
}

// ─── Setting row ──────────────────────────────────────────────────────────────
function Prop({
  name,
  type,
  defaultVal,
  children,
  optional = true,
}: {
  name: string
  type: string
  defaultVal?: string
  children: React.ReactNode
  optional?: boolean
}) {
  return (
    <div className="py-3 border-b border-gray-200 dark:border-gray-800/60 last:border-0">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <code className="text-[13px] font-mono text-gray-900 dark:text-white">{name}</code>
        {!optional && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
            required
          </span>
        )}
        <Badge type={type} />
        {defaultVal && (
          <span className="text-[11px] text-gray-500 dark:text-gray-500">
            default: <code className="text-gray-600 dark:text-gray-400">{defaultVal}</code>
          </span>
        )}
      </div>
      <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{children}</p>
    </div>
  )
}

// ─── Section heading ──────────────────────────────────────────────────────────
function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <span className="w-1 h-5 bg-emerald-500 rounded-full inline-block" />
        {title}
      </h2>
      {children}
    </section>
  )
}

function SubSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="mb-8 scroll-mt-6">
      <h3 className="text-[15px] font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed mb-3">{children}</p>
  )
}

function CalloutBox({
  title,
  children,
  color = 'emerald',
}: {
  title: string
  children: React.ReactNode
  color?: 'emerald' | 'amber' | 'blue'
}) {
  const styles = {
    emerald:
      'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-300',
    amber:
      'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-300',
    blue: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800/50 dark:text-blue-300',
  }
  return (
    <div className={`border rounded-lg p-4 my-4 ${styles[color]}`}>
      <p className="text-[12px] font-bold uppercase tracking-wider mb-2">{title}</p>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </div>
  )
}

// ─── Nav sections ─────────────────────────────────────────────────────────────
const NAV = [
  { id: 'step-context', label: 'Step Context' },
  { id: 'step-types', label: 'Step Types' },
  { id: 'step-settings', label: 'Step Settings' },
  { id: 'browser-settings', label: 'Browser Settings' },
  { id: 'parser-settings', label: 'Parser Settings' },
  { id: 'cloudflare-bypass', label: 'Cloudflare Bypass' },
  { id: 'recipes', label: 'Recipes' },
]

// ─── Main page ────────────────────────────────────────────────────────────────
export function DocsPage() {
  const [active, setActive] = useState('step-context')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length) setActive(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -70% 0px' },
    )
    NAV.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observerRef.current?.observe(el)
    })
    return () => observerRef.current?.disconnect()
  }, [])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex min-h-full">
      {/* Sidebar nav */}
      <aside className="w-52 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-gray-200 dark:border-gray-800 px-3 py-6 hidden md:block">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 px-2 mb-3">
          Reference
        </p>
        <nav className="space-y-0.5">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={[
                'w-full text-left px-2 py-1.5 rounded text-[13px] transition-colors',
                active === id
                  ? 'bg-emerald-50 text-emerald-700 font-medium dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800/50',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 px-8 py-8 max-w-3xl">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Developer Reference
          </h1>
          <p className="text-[14px] text-gray-600 dark:text-gray-400">
            Everything available when writing Traverser and Extractor step code.
          </p>
        </div>

        {/* ── Step Context ─────────────────────────────────────────────── */}
        <Section id="step-context" title="Step Context">
          <P>
            Every step function receives two arguments injected into its execution scope. You don't
            declare them — they're available directly.
          </P>

          <SubSection id="context-page" title="page">
            <P>
              A Playwright (or Puppeteer){' '}
              <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">Page</code>{' '}
              object for the current URL. The browser has already navigated to{' '}
              <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">task.url</code>{' '}
              before your code runs.
            </P>
            <Code>
              {`// Query elements
const title = await page.$eval('h1', el => el.textContent?.trim())

// Wait for selector
await page.waitForSelector('.product-grid', { timeout: 10_000 })

// Evaluate in page context
const items = await page.$$eval('a.item', els => els.map(el => ({
  href: el.href,
  text: el.textContent?.trim(),
})))

// Intercept network (Playwright only)
await page.route('**/*.png', route => route.abort())

// Take screenshot for debugging
const buf = await page.screenshot()
console.log('screenshot size:', buf.length)`}
            </Code>
            <CalloutBox title="Browser type" color="blue">
              The page object type depends on <strong>browserType</strong> in parser settings.
              Playwright and Playwright Stealth expose the full Playwright API. Puppeteer exposes
              the Puppeteer API — <code>page.evaluate</code>, <code>page.$$</code> etc. work on
              both.
            </CalloutBox>
          </SubSection>

          <SubSection id="context-task" title="task">
            <P>Metadata about the current page task being processed.</P>
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-3">
              <Prop name="task.url" type="string" optional={false}>
                The URL this task navigated to. Same as{' '}
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">page.url()</code> but
                available before navigation.
              </Prop>
              <Prop name="task.id" type="string" optional={false}>
                Unique task ID (UUID). Useful for logging.
              </Prop>
              <Prop name="task.stepName" type="string" optional={false}>
                Name of the step executing this task (e.g.{' '}
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">"Index"</code>).
              </Prop>
              <Prop name="task.parent_data" type="object" defaultVal="{}">
                Data passed down from the parent traverser. Use to carry context through the
                pipeline (e.g. category name, product type).
              </Prop>
              <Prop name="task.attempts" type="number" defaultVal="1">
                How many times this task has been attempted. Check this to skip expensive operations
                on retries.
              </Prop>
            </div>
            <Code>
              {`// Access parent data passed from a traverser
const { category, product_type } = task.parent_data ?? {}

// Log task info
console.log(\`[\${task.stepName}] attempt \${task.attempts}: \${task.url}\`)

// Skip heavy work on retries
if (task.attempts === 1) {
  await page.waitForTimeout(2000) // only wait on first attempt
}`}
            </Code>
          </SubSection>

          <SubSection id="context-solvecf" title="solveCF(url, options?)">
            <P>
              Bypasses Cloudflare managed challenges by routing the request through a FlareSolverr
              or Byparr instance. Returns the full{' '}
              <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">solution</code>{' '}
              object.
            </P>
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-3">
              <Prop name="url" type="string" optional={false}>
                The URL to fetch through the solver.
              </Prop>
              <Prop name="options" type="object" defaultVal="{}">
                Any FlareSolverr/Byparr{' '}
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">request.get</code>{' '}
                parameters. See{' '}
                <a href="#cloudflare-bypass" className="text-emerald-400 hover:underline">
                  Cloudflare Bypass
                </a>{' '}
                for all options.
              </Prop>
            </div>
            <Code>
              {`// Basic — get HTML after CF challenge solved
const { response } = await solveCF(task.url)
await page.setContent(response)

// With options
const { response, cookies } = await solveCF(task.url, {
  maxTimeout: 120_000,
  disableMedia: true,
  waitInSeconds: 2,
})
await page.setContent(response)`}
            </Code>
            <CalloutBox title="Requires setup" color="amber">
              Set the <strong>Cloudflare Solver URL</strong> in the Parser Settings modal, or set{' '}
              <code>flareSolverrUrl</code> in step settings to override per-step. Without a solver
              URL, calling <code>solveCF()</code> throws a descriptive error.
            </CalloutBox>
          </SubSection>
        </Section>

        {/* ── Step Types ───────────────────────────────────────────────── */}
        <Section id="step-types" title="Step Types">
          <P>
            A parser pipeline is a chain of steps. Each step is either a{' '}
            <strong className="text-gray-900 dark:text-white">Traverser</strong> (discovers more
            URLs) or an <strong className="text-gray-900 dark:text-white">Extractor</strong>{' '}
            (collects data). You choose the type when creating a step.
          </P>

          <SubSection id="types-traverser" title="Traverser">
            <P>
              Returns an array of links for the next step to process. The{' '}
              <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">page_type</code>{' '}
              field must match the name of an existing step.
            </P>
            <Code>
              {`// Return type: TraverserResult[]
return [
  {
    link: 'https://example.com/products/shoes',  // required — URL to visit next
    page_type: 'ProductList',                     // required — step name to handle this URL
    parent_data: {                                // optional — passed to next step as task.parent_data
      category: 'Shoes',
      source_url: task.url,
    },
  },
]`}
            </Code>
            <P>
              Traversers are typically used for index/category/pagination pages. Results are
              deduplicated (if enabled in parser settings) before being queued.
            </P>
          </SubSection>

          <SubSection id="types-extractor" title="Extractor">
            <P>
              Returns an array of data rows. Each row is written to the step's output file (CSV,
              JSON, or Excel).
            </P>
            <Code>
              {`// Return type: Record<string, unknown>[]
return [
  {
    title: await page.$eval('h1', el => el.textContent?.trim()),
    price: await page.$eval('.price', el => el.textContent?.trim()).catch(() => null),
    sku: await page.$eval('[data-sku]', el => el.dataset.sku).catch(() => null),
    __url: task.url,                    // convention: include source URL
    ...task.parent_data,                // spread parent context into row
  },
]`}
            </Code>
            <CalloutBox title="Multiple rows" color="blue">
              Return multiple objects in the array to write multiple rows per page. Return{' '}
              <code>[]</code> to skip a page without failing.
            </CalloutBox>
          </SubSection>
        </Section>

        {/* ── Step Settings ─────────────────────────────────────────────── */}
        <Section id="step-settings" title="Step Settings">
          <P>
            Configured per-step via the step settings button in the editor. Step-level settings
            override parser-level browser settings.
          </P>

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <Prop name="concurrency" type="number" defaultVal="3">
              Number of pages this step processes in parallel. Higher values speed up scraping but
              increase detection risk.
            </Prop>
            <Prop name="pageDelayMin" type="number" defaultVal="0">
              Minimum delay in milliseconds between page requests. Randomized up to{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">pageDelayMax</code>.
            </Prop>
            <Prop name="pageDelayMax" type="number" defaultVal="0">
              Maximum delay in milliseconds between page requests. Set both min and max to add
              human-like timing.
            </Prop>
            <Prop name="maxPagesPerContext" type="number" defaultVal="0">
              Rotate the browser context (new cookies, fingerprint) after this many pages.
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">0</code> = never
              rotate.
            </Prop>
            <Prop name="userAgent" type="string">
              Override the browser's user agent string for every request in this step.
            </Prop>
            <Prop name="initScripts" type="array">
              JavaScript strings injected into every page before load. Runs before CSP is enforced —
              useful for patching{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                navigator.webdriver
              </code>{' '}
              etc.
            </Prop>
            <Prop name="contextOptions" type="object">
              Playwright{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                BrowserContextOptions
              </code>
              : <code className="text-gray-600 dark:text-gray-300 text-[12px]">locale</code>,{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">timezoneId</code>,{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">viewport</code>,{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">extraHTTPHeaders</code>
              , etc.
            </Prop>
            <Prop name="launchOptions" type="object">
              Playwright{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">LaunchOptions</code>:{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">headless</code>,{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">args</code>, etc. Set{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">headless: false</code>{' '}
              to debug locally.
            </Prop>
            <Prop name="proxySettings" type="object">
              Single proxy:{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                {'{ host, port, username?, password? }'}
              </code>
              . Applied to every request in this step.
            </Prop>
            <Prop name="proxyPool" type="array">
              Array of proxy URLs (
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                http://user:pass@host:port
              </code>
              ) used in round-robin. Overrides{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">proxySettings</code>{' '}
              when set.
            </Prop>
            <Prop name="flareSolverrUrl" type="string">
              Override the Cloudflare solver endpoint for this step. Takes priority over{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">FLARESOLVERR_URL</code>{' '}
              env var and parser-level setting.
            </Prop>
            <Prop name="outputFormat" type="enum" defaultVal="csv">
              Output file format for Extractor steps:{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">'csv'</code> |{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">'json'</code> |{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">'excel'</code>.
            </Prop>
          </div>

          <Code>
            {`// Example step settings JSON
{
  "concurrency": 5,
  "pageDelayMin": 2000,
  "pageDelayMax": 6000,
  "maxPagesPerContext": 20,
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
  "contextOptions": {
    "locale": "en-US",
    "timezoneId": "America/New_York",
    "viewport": { "width": 1280, "height": 800 }
  },
  "initScripts": [
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
  ],
  "proxyPool": [
    "http://user:pass@proxy1.example.com:8080",
    "http://user:pass@proxy2.example.com:8080"
  ]
}`}
          </Code>
        </Section>

        {/* ── Browser Settings ─────────────────────────────────────────── */}
        <Section id="browser-settings" title="Browser Settings">
          <P>
            Parser-level settings applied to all steps unless overridden. Configured in the Parser
            Settings modal →{' '}
            <strong className="text-gray-700 dark:text-gray-200">Browser Settings</strong> JSON
            field.
          </P>

          <SubSection id="browser-type" title="browser_type">
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-3">
              <Prop name="browser_type" type="enum" defaultVal="playwright">
                Which browser adapter to use for all steps in this parser.
              </Prop>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { name: 'playwright', desc: 'Default. Chromium via Playwright. Fast, full API.' },
                {
                  name: 'playwright-stealth',
                  desc: 'Playwright + stealth plugin. Patches fingerprinting vectors.',
                },
                {
                  name: 'puppeteer',
                  desc: 'Chrome via Puppeteer + stealth. Alternative fingerprint.',
                },
              ].map(({ name, desc }) => (
                <div key={name} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <code className="text-[12px] text-emerald-300 block mb-1">"{name}"</code>
                  <p className="text-[12px] text-gray-400">{desc}</p>
                </div>
              ))}
            </div>
          </SubSection>
        </Section>

        {/* ── Parser Settings ───────────────────────────────────────────── */}
        <Section id="parser-settings" title="Parser Settings">
          <P>Configured in the Parser Settings modal. Apply to the whole parser run.</P>

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <Prop name="retryConfig.maxRetries" type="number" defaultVal="0">
              How many times to retry a failed task before marking it permanently failed. Each retry
              re-navigates to the URL.
            </Prop>
            <Prop name="deduplication" type="boolean" defaultVal="true">
              Skip URLs already seen in this run. Prevents infinite loops on paginated sites.
              Disable only if you need to revisit URLs.
            </Prop>
            <Prop name="concurrentQuota" type="number">
              Maximum total concurrent tasks across all steps. Unlimited if blank. Use to throttle
              overall resource usage.
            </Prop>
            <Prop name="flareSolverrUrl" type="string">
              URL of the FlareSolverr or Byparr solver for this parser (e.g.{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                http://localhost:8191
              </code>
              ). Set via the{' '}
              <strong className="text-gray-700 dark:text-gray-200">Cloudflare Solver URL</strong>{' '}
              field in the Parser Settings modal. Step-level{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">flareSolverrUrl</code>{' '}
              overrides this.
            </Prop>
            <Prop name="browserSettings" type="object">
              Parser-level browser config. Any{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">StepSettings</code>{' '}
              field is valid here. Overridden per-step by step settings.
            </Prop>
          </div>
        </Section>

        {/* ── Cloudflare Bypass ─────────────────────────────────────────── */}
        <Section id="cloudflare-bypass" title="Cloudflare Bypass">
          <P>
            The{' '}
            <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">
              solveCF(url, options?)
            </code>{' '}
            helper routes requests through a local FlareSolverr or Byparr instance that runs a real
            browser to solve Cloudflare managed challenges.
          </P>

          <SubSection id="cf-setup" title="Setup">
            <P>
              <strong className="text-gray-700 dark:text-gray-200">Step 1</strong> — Start a solver
              with Docker:
            </P>
            <Code>
              {`# FlareSolverr
docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest

# Byparr (drop-in replacement, often better CF bypass rate)
docker run -d -p 8191:8191 ghcr.io/thephaseless/byparr:latest`}
            </Code>
            <P>
              <strong className="text-gray-700 dark:text-gray-200">Step 2</strong> — Open the{' '}
              <strong className="text-gray-700 dark:text-gray-200">Parser Settings</strong> modal (⚙
              General &amp; Browser Settings button in the editor) and paste the solver URL into the{' '}
              <strong className="text-gray-700 dark:text-gray-200">Cloudflare Solver URL</strong>{' '}
              field:
            </P>
            <Code>{`http://localhost:8191`}</Code>
            <P>
              That's it — no{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">.env</code> changes
              needed. The URL is saved per-parser. Use{' '}
              <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">
                flareSolverrUrl
              </code>{' '}
              in step settings to point individual steps at a different solver instance.
            </P>
          </SubSection>

          <SubSection id="cf-options" title="solveCF options">
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <Prop name="maxTimeout" type="number" defaultVal="60000">
                Max milliseconds to wait for the challenge to be solved.
              </Prop>
              <Prop name="session" type="string">
                Reuse an existing solver browser session by name. Saves startup time; useful for
                sites that track session state across pages.
              </Prop>
              <Prop name="session_ttl_minutes" type="number">
                Auto-rotate the named session after this many minutes.
              </Prop>
              <Prop name="cookies" type="array">
                Inject cookies before the page loads:
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                  {' [{ name, value }]'}
                </code>
                .
              </Prop>
              <Prop name="returnOnlyCookies" type="boolean" defaultVal="false">
                Skip returning HTML; only return{' '}
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                  solution.cookies
                </code>
                . Faster when you only need CF clearance cookies.
              </Prop>
              <Prop name="returnScreenshot" type="boolean" defaultVal="false">
                Include a base64 PNG screenshot in{' '}
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                  solution.screenshot
                </code>
                .
              </Prop>
              <Prop name="waitInSeconds" type="number">
                Extra seconds to wait after the challenge resolves before capturing the page. Useful
                for SPA hydration.
              </Prop>
              <Prop name="disableMedia" type="boolean" defaultVal="false">
                Block images, CSS, and fonts. Speeds up solving on heavy pages.
              </Prop>
              <Prop name="proxy" type="object">
                Route the solver's request through a proxy:
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                  {' { url: "http://host:port" }'}
                </code>
                . Ignored when{' '}
                <code className="text-gray-600 dark:text-gray-300 text-[12px]">session</code> is
                set.
              </Prop>
            </div>
          </SubSection>

          <SubSection id="cf-response" title="solution object">
            <P>
              <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">solveCF()</code>{' '}
              returns the full{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">solution</code> object:
            </P>
            <Code>
              {`const solution = await solveCF(task.url)

solution.response    // string — full page HTML
solution.cookies     // { name, value, domain, ... }[]
solution.userAgent   // string — UA used by the solver
solution.screenshot  // string | undefined — base64 PNG (if requested)`}
            </Code>
          </SubSection>
        </Section>

        {/* ── Recipes ───────────────────────────────────────────────────── */}
        <Section id="recipes" title="Recipes">
          <SubSection id="recipe-traverser" title="Traverser — paginated list">
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

          <SubSection id="recipe-extractor" title="Extractor — product page">
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

          <SubSection id="recipe-cf" title="Cloudflare bypass">
            <Code>
              {`// Detect CF block and solve on demand
const isCFBlock = await page.$('#challenge-error-text') !== null

if (isCFBlock) {
  const { response, cookies } = await solveCF(task.url, {
    disableMedia: true,
    waitInSeconds: 2,
  })
  // Load solved HTML into Playwright for normal scraping
  await page.setContent(response)
}

// Continue scraping normally
const items = await page.$$eval('a.product', els => els.map(el => el.href))`}
            </Code>
          </SubSection>

          <SubSection id="recipe-cookies" title="Inject CF cookies into Playwright">
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

          <SubSection id="recipe-session" title="Reuse solver session across pages">
            <Code>
              {`// Name a session so the solver browser stays warm across tasks
// (add this to your step code; the session lives in the solver process)
const SESSION = 'my-parser-session'

const { response } = await solveCF(task.url, {
  session: SESSION,
  session_ttl_minutes: 30,
})
await page.setContent(response)`}
            </Code>
          </SubSection>

          <SubSection id="recipe-debug" title="Debug: disable headless locally">
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

        <div className="pb-16" />
      </div>
    </div>
  )
}
