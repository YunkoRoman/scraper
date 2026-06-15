import { Prop, Section, SubSection, P, PageWrapper } from './shared'

export function BrowserSettingsPage() {
  return (
    <PageWrapper
      title="Browser Settings"
      description="Parser-level browser config applied to all steps unless overridden."
    >
      <P>
        Configured in the Parser Settings modal →{' '}
        <strong className="text-gray-700 dark:text-gray-200">Browser Settings</strong> JSON field.
        Any field here can be overridden per-step via step settings.
      </P>

      <Section title="browser_type">
        <SubSection title="Options">
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-4">
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

      <Section title="Other fields">
        <SubSection title="Inherited from Step Settings">
          <P>
            All <strong className="text-gray-700 dark:text-gray-200">Step Settings</strong> fields
            are valid here too —{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">concurrency</code>,{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">pageDelayMin</code>,{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">proxyPool</code>,{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">contextOptions</code>,
            etc. They apply to every step unless a step overrides them with its own step settings.
          </P>
        </SubSection>
      </Section>
    </PageWrapper>
  )
}
