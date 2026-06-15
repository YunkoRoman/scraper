// Rewrites top-of-file single-line static imports of local helper modules into
// `await import()` calls that can run inside an AsyncFunction body.
//
//   import { a, b } from './x'   -> const { a, b } = await import('${tempDir}/x.ts')
//   import name from './x'       -> const { default: name } = await import('${tempDir}/x.ts')
//   import * as ns from './x'    -> const ns = await import('${tempDir}/x.ts')
//
// Only lines at the top of the file (before the first non-import, non-comment,
// non-blank line) are transformed. Imports must be single-line and reference a
// local module path starting with './'.

const NAMED = /^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/
const NAMESPACE = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/
const DEFAULT = /^import\s+([A-Za-z_$][\w$]*)\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/

function importPath(tempDir: string, name: string): string {
  return `${tempDir}/${name}.ts`
}

function rewriteLine(line: string, tempDir: string): string | null {
  let m = line.match(NAMED)
  if (m) return `const {${m[1]}} = await import('${importPath(tempDir, m[2])}')`
  m = line.match(NAMESPACE)
  if (m) return `const ${m[1]} = await import('${importPath(tempDir, m[2])}')`
  m = line.match(DEFAULT)
  if (m) return `const { default: ${m[1]} } = await import('${importPath(tempDir, m[2])}')`
  return null
}

export function transformImports(code: string, tempDir: string): string {
  const lines = code.split('\n')
  const out: string[] = []
  let inImportRegion = true

  for (const line of lines) {
    if (inImportRegion) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('//')) {
        out.push(line)
        continue
      }
      if (trimmed.startsWith('import')) {
        const rewritten = rewriteLine(trimmed, tempDir)
        out.push(rewritten ?? line)
        continue
      }
      // First real line of logic — stop transforming.
      inImportRegion = false
    }
    out.push(line)
  }

  return out.join('\n')
}
