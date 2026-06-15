import { Code, Section, SubSection, P, CalloutBox, PageWrapper } from './shared'

export function StepTypesPage() {
  return (
    <PageWrapper
      title="Step Types"
      description="Traversers discover URLs; Extractors collect data."
    >
      <P>
        A parser pipeline is a chain of steps. Each step is either a{' '}
        <strong className="text-gray-900 dark:text-white">Traverser</strong> (discovers more URLs)
        or an <strong className="text-gray-900 dark:text-white">Extractor</strong> (collects data).
        You choose the type when creating a step.
      </P>

      <Section title="Traverser">
        <SubSection title="Overview">
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
            Traversers are typically used for index, category, and pagination pages. Results are
            deduplicated (if enabled in parser settings) before being queued.
          </P>
        </SubSection>
      </Section>

      <Section title="Extractor">
        <SubSection title="Overview">
          <P>
            Returns an array of data rows. Each row is written to the step's output file (CSV, JSON,
            or Excel).
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
    </PageWrapper>
  )
}
