import { Code, Prop, Section, SubSection, P, CalloutBox, PageWrapper } from './shared'

export function HelperFilesPage() {
  return (
    <PageWrapper
      title="Helper Files"
      description="Per-parser TypeScript modules you can import into any step."
    >
      <P>
        Helper files are per-parser TypeScript modules stored in the database. They let you split
        step logic into reusable utilities and import them into any Traverser or Extractor step with
        standard <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">import</code>{' '}
        syntax.
      </P>

      <Section title="Creating files">
        <SubSection title="In the editor">
          <P>
            Open the parser editor. Below the step list in the left sidebar you'll find a{' '}
            <strong className="text-gray-700 dark:text-gray-200">Files</strong> section with a{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">+</code> button. Click
            it, type a filename (e.g.{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">validate</code>), and
            press{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px] border border-gray-300 dark:border-gray-700">
              Enter
            </kbd>
            . The file opens immediately in the Monaco editor.
          </P>
          <CalloutBox title="Naming rules" color="blue">
            File names must be valid JavaScript identifiers — letters, digits, <code>_</code>,{' '}
            <code>$</code>, no slashes or dots. The <code>.ts</code> extension is added
            automatically. Files are flat — there are no subfolders.
          </CalloutBox>
        </SubSection>
      </Section>

      <Section title="Importing in step code">
        <SubSection title="Syntax">
          <P>
            Use standard{' '}
            <code className="text-emerald-600 dark:text-emerald-400 text-[12px]">import</code>{' '}
            statements at the top of your step code. The path must start with{' '}
            <code className="text-gray-600 dark:text-gray-300 text-[12px]">'./'</code> followed by
            the file name (no extension).
          </P>
          <Code>
            {`// Named import
import { validate, normalise } from './validate'

// Default import
import validate from './validate'

// Namespace import
import * as utils from './utils'

// Then use normally in your step code:
const rows = items.map(item => ({
  ...normalise(item),
  valid: validate(item),
}))`}
          </Code>
          <CalloutBox title="No await needed" color="emerald">
            Write plain <code>import</code> statements — the platform rewrites them to dynamic
            imports automatically before running your code. You never need to write{' '}
            <code>await import()</code> yourself.
          </CalloutBox>
        </SubSection>
      </Section>

      <Section title="Constraints">
        <SubSection title="Rules">
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <Prop name="Flat structure" type="string" optional>
              No subfolders. All helper files live at the parser root.
            </Prop>
            <Prop name="Single-line imports" type="string" optional>
              Multi-line import braces are not supported. Keep each import on one line.
            </Prop>
            <Prop name="Top of file only" type="string" optional>
              Imports must appear before any non-import, non-comment code. Imports inside functions
              or after logic are not transformed.
            </Prop>
            <Prop name="TypeScript supported" type="string" optional>
              Helper files run through{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">tsx</code>, so full
              TypeScript syntax is available — types, interfaces, generics.
            </Prop>
            <Prop name="Relative paths only" type="string" optional>
              Only <code className="text-gray-600 dark:text-gray-300 text-[12px]">'./'</code> paths
              are recognised. Absolute imports or{' '}
              <code className="text-gray-600 dark:text-gray-300 text-[12px]">node_modules</code>{' '}
              imports are passed through unchanged and will resolve against the server process.
            </Prop>
          </div>
        </SubSection>
      </Section>
    </PageWrapper>
  )
}
