import { Code, Prop, Section, SubSection, P, PageWrapper } from './shared'

export function StepSettingsPage() {
  return (
    <PageWrapper
      title="Step Settings"
      description="Per-step browser configuration. Overrides parser-level browser settings."
    >
      <P>
        Configured per-step via the step settings button in the editor. Step-level settings override
        parser-level browser settings.
      </P>

      <Section title="Reference">
        <SubSection title="All fields">
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
              Rotate the browser context (new cookies, fingerprint) after this many pages.{' '}
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
        </SubSection>

        <SubSection title="Example">
          <Code>
            {`{
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
        </SubSection>
      </Section>
    </PageWrapper>
  )
}
