import { Code, Prop, Section, SubSection, P, CalloutBox, PageWrapper } from './shared'

export function StepContextPage() {
  return (
    <PageWrapper
      title="Step Context"
      description="Variables injected into every step function at runtime."
    >
      <P>
        Every step function receives two arguments injected into its execution scope. You don't
        declare them — they're available directly.
      </P>

      <Section title="page">
        <SubSection title="Overview">
          <P>
            A Playwright (or Puppeteer){' '}
            <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">Page</code> object
            for the current URL. The browser has already navigated to{' '}
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
            Playwright and Playwright Stealth expose the full Playwright API. Puppeteer exposes the
            Puppeteer API — <code>page.evaluate</code>, <code>page.$$</code> etc. work on both.
          </CalloutBox>
        </SubSection>
      </Section>

      <Section title="task">
        <SubSection title="Properties">
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
              Data passed down from the parent traverser. Use to carry context through the pipeline
              (e.g. category name, product type).
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
      </Section>

      <Section title="solveCF(url, options?)">
        <SubSection title="Overview">
          <P>
            Bypasses Cloudflare managed challenges by routing the request through a FlareSolverr or
            Byparr instance. Returns the full{' '}
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
              parameters. See the Cloudflare Bypass page for all options.
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
    </PageWrapper>
  )
}
