import { Prop, Section, SubSection, P, PageWrapper } from './shared'

export function ParserSettingsPage() {
  return (
    <PageWrapper
      title="Parser Settings"
      description="Run-level configuration for the whole parser."
    >
      <P>Configured in the Parser Settings modal. These settings apply to the whole parser run.</P>

      <Section title="Reference">
        <SubSection title="All fields">
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
        </SubSection>
      </Section>
    </PageWrapper>
  )
}
