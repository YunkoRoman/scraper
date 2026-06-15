import { describe, it, expect } from 'vitest'
import { transformImports } from '../infrastructure/worker/transformImports.js'

const DIR = '/tmp/scraper-modules/demo'

describe('transformImports', () => {
  it('rewrites named imports to await import with destructuring', () => {
    const out = transformImports(`import { validate, retry } from './helpers'\nreturn []`, DIR)
    expect(out).toContain(`const { validate, retry } = await import('${DIR}/helpers.ts')`)
    expect(out).not.toContain('import {')
  })

  it('rewrites default imports', () => {
    const out = transformImports(`import validate from './validate'\nreturn []`, DIR)
    expect(out).toContain(`const { default: validate } = await import('${DIR}/validate.ts')`)
  })

  it('rewrites namespace imports', () => {
    const out = transformImports(`import * as v from './v'\nreturn []`, DIR)
    expect(out).toContain(`const v = await import('${DIR}/v.ts')`)
  })

  it('stops transforming once a non-import, non-comment, non-blank line is reached', () => {
    const code = `import { a } from './a'\nconst x = 1\nimport { b } from './b'`
    const out = transformImports(code, DIR)
    expect(out).toContain(`const { a } = await import('${DIR}/a.ts')`)
    // The second import is below logic — left untouched.
    expect(out).toContain(`import { b } from './b'`)
  })

  it('passes through leading comments and blank lines before imports', () => {
    const code = `// header\n\nimport { a } from './a'\nreturn []`
    const out = transformImports(code, DIR)
    expect(out).toContain(`const { a } = await import('${DIR}/a.ts')`)
  })

  it('leaves code without imports unchanged', () => {
    const code = `const page = 1\nreturn []`
    expect(transformImports(code, DIR)).toBe(code)
  })
})
