import { Code, Prop, Section, SubSection, P, PageWrapper } from './shared'

export function CloudflareBypassPage() {
  return (
    <PageWrapper
      title="Cloudflare Bypass"
      description="Route requests through FlareSolverr or Byparr to solve CF managed challenges."
    >
      <P>
        The{' '}
        <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">
          solveCF(url, options?)
        </code>{' '}
        helper routes requests through a local FlareSolverr or Byparr instance that runs a real
        browser to solve Cloudflare managed challenges.
      </P>

      <Section title="Setup">
        <SubSection title="Step 1 — start a solver">
          <Code>
            {`# FlareSolverr
docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest

# Byparr (drop-in replacement, often better CF bypass rate)
docker run -d -p 8191:8191 ghcr.io/thephaseless/byparr:latest`}
          </Code>
        </SubSection>

        <SubSection title="Step 2 — configure the parser">
          <P>
            Open the <strong className="text-gray-700 dark:text-gray-200">Parser Settings</strong>{' '}
            modal (⚙ General &amp; Browser Settings button in the editor) and paste the solver URL
            into the{' '}
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
      </Section>

      <Section title="solveCF options">
        <SubSection title="All options">
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <Prop name="maxTimeout" type="number" defaultVal="60000">
              Max milliseconds to wait for the challenge to be solved.
            </Prop>
            <Prop name="session" type="string">
              Reuse an existing solver browser session by name. Saves startup time; useful for sites
              that track session state across pages.
            </Prop>
            <Prop name="session_ttl_minutes" type="number">
              Auto-rotate the named session after this many minutes.
            </Prop>
            <Prop name="cookies" type="array">
              Inject cookies before the page loads:{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                {'[{ name, value }]'}
              </code>
              .
            </Prop>
            <Prop name="returnOnlyCookies" type="boolean" defaultVal="false">
              Skip returning HTML; only return{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">solution.cookies</code>
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
              Route the solver's request through a proxy:{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">
                {'{ url: "http://host:port" }'}
              </code>
              . Ignored when{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">session</code> is set.
            </Prop>
          </div>
        </SubSection>
      </Section>

      <Section title="solution object">
        <SubSection title="Return value">
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
    </PageWrapper>
  )
}
