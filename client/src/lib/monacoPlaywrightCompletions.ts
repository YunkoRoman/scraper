import type { Monaco } from '@monaco-editor/react'

export interface CompletionItemSpec {
  label: string
  insertText: string
  detail: string
  documentation?: string
}

const PAGE_METHODS: CompletionItemSpec[] = [
  {
    label: 'goto',
    insertText: "goto('${1:url}')",
    detail: '(url) => Promise<Response>',
    documentation: 'Navigate to a URL.',
  },
  {
    label: 'click',
    insertText: "click('${1:selector}')",
    detail: '(selector) => Promise<void>',
    documentation: 'Click an element.',
  },
  {
    label: 'fill',
    insertText: "fill('${1:selector}', '${2:value}')",
    detail: '(selector, value) => Promise<void>',
    documentation: 'Fill an input field.',
  },
  {
    label: '$eval',
    insertText: "$eval('${1:selector}', el => ${2:el.textContent})",
    detail: '(selector, fn) => Promise<T>',
    documentation: 'Evaluate over the first matching element.',
  },
  {
    label: '$$eval',
    insertText: "$$eval('${1:selector}', els => els.map(${2:e => e.href}))",
    detail: '(selector, fn) => Promise<T>',
    documentation: 'Evaluate over all matching elements.',
  },
  {
    label: 'waitForSelector',
    insertText: "waitForSelector('${1:selector}')",
    detail: '(selector, options?) => Promise<ElementHandle>',
    documentation: 'Wait until selector appears.',
  },
  {
    label: 'waitForLoadState',
    insertText: "waitForLoadState('${1:domcontentloaded}')",
    detail: '(state?) => Promise<void>',
    documentation: "Wait for 'load' | 'domcontentloaded' | 'networkidle'.",
  },
  {
    label: 'evaluate',
    insertText: 'evaluate(() => ${1:document.title})',
    detail: '(fn, arg?) => Promise<T>',
    documentation: 'Run JS in the page context.',
  },
  {
    label: 'locator',
    insertText: "locator('${1:selector}')",
    detail: '(selector) => Locator',
    documentation: 'Build a locator (chainable, auto-waits).',
  },
  {
    label: 'screenshot',
    insertText: "screenshot({ path: '${1:shot.png}' })",
    detail: '(options?) => Promise<Buffer>',
    documentation: 'Take a page screenshot.',
  },
  {
    label: 'content',
    insertText: 'content()',
    detail: '() => Promise<string>',
    documentation: 'Get the full HTML content.',
  },
  {
    label: 'title',
    insertText: 'title()',
    detail: '() => Promise<string>',
    documentation: 'Get the document title.',
  },
  {
    label: 'url',
    insertText: 'url()',
    detail: '() => string',
    documentation: 'Get the current URL.',
  },
  {
    label: 'keyboard',
    insertText: "keyboard.press('${1:Enter}')",
    detail: 'Keyboard',
    documentation: 'Keyboard API (press/type/down/up).',
  },
  {
    label: 'mouse',
    insertText: 'mouse.move(${1:0}, ${2:0})',
    detail: 'Mouse',
    documentation: 'Mouse API (move/click/down/up/wheel).',
  },
  {
    label: 'selectOption',
    insertText: "selectOption('${1:selector}', '${2:value}')",
    detail: '(selector, value) => Promise<string[]>',
    documentation: 'Select <option> by value/label.',
  },
  {
    label: 'hover',
    insertText: "hover('${1:selector}')",
    detail: '(selector) => Promise<void>',
    documentation: 'Hover an element.',
  },
  {
    label: 'check',
    insertText: "check('${1:selector}')",
    detail: '(selector) => Promise<void>',
    documentation: 'Check a checkbox/radio.',
  },
  {
    label: 'uncheck',
    insertText: "uncheck('${1:selector}')",
    detail: '(selector) => Promise<void>',
    documentation: 'Uncheck a checkbox.',
  },
  {
    label: 'type',
    insertText: "type('${1:selector}', '${2:text}')",
    detail: '(selector, text) => Promise<void>',
    documentation: 'Type characters into a field.',
  },
]

const TASK_FIELDS: CompletionItemSpec[] = [
  { label: 'url', insertText: 'url', detail: 'string', documentation: 'Current task URL.' },
  {
    label: 'parent_data',
    insertText: 'parent_data',
    detail: 'Record<string, unknown>',
    documentation: 'Data passed from the parent traverser step.',
  },
]

export function buildPlaywrightCompletionItems(): CompletionItemSpec[] {
  return PAGE_METHODS
}

export function buildTaskCompletionItems(): CompletionItemSpec[] {
  return TASK_FIELDS
}

let _registered = false

export function registerPlaywrightCompletions(monaco: Monaco): void {
  if (_registered) return
  _registered = true

  const toMonacoItems = (
    specs: CompletionItemSpec[],
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    },
  ) =>
    specs.map((s) => ({
      label: s.label,
      kind: monaco.languages.CompletionItemKind.Method,
      insertText: s.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: s.detail,
      documentation: s.documentation,
      range,
    }))

  monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    provideCompletionItems(
      model: { getLineContent: (n: number) => string },
      position: { lineNumber: number; column: number },
    ) {
      const line = model.getLineContent(position.lineNumber)
      const before = line.slice(0, position.column - 1)
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }
      if (/\bpage\.$/.test(before)) return { suggestions: toMonacoItems(PAGE_METHODS, range) }
      if (/\btask\.$/.test(before)) return { suggestions: toMonacoItems(TASK_FIELDS, range) }
      return { suggestions: [] }
    },
  })
}
