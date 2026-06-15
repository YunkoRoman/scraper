import { describe, it, expect } from 'vitest'

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function parseCsvRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (const char of line) {
    if (char === '"') {
      inQuote = !inQuote
    } else if (char === ',' && !inQuote) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const allRows: string[][] = []
  let row: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQuote) {
      if (ch === '"' && next === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuote = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        row.push(current)
        current = ''
      } else if (ch === '\r' && next === '\n') {
        row.push(current)
        current = ''
        allRows.push(row)
        row = []
        i++
      } else if (ch === '\n') {
        row.push(current)
        current = ''
        allRows.push(row)
        row = []
      } else {
        current += ch
      }
    }
  }
  if (current || row.length > 0) {
    row.push(current)
    allRows.push(row)
  }

  if (allRows.length === 0) return { headers: [], rows: [] }
  const headers = allRows[0]
  const rows = allRows.slice(1).filter((r) => r.some((c) => c.trim()))
  return { headers, rows }
}

describe('formatDuration', () => {
  it('formats seconds into Xm Ys', () => {
    expect(formatDuration(272)).toBe('4m 32s')
  })
  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0m 0s')
  })
  it('returns — for null', () => {
    expect(formatDuration(null)).toBe('—')
  })
  it('handles sub-minute', () => {
    expect(formatDuration(45)).toBe('0m 45s')
  })
})

describe('parseCsvRow', () => {
  it('splits a simple CSV row', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c'])
  })
  it('handles quoted fields containing commas', () => {
    expect(parseCsvRow('"hello, world",foo,bar')).toEqual(['hello, world', 'foo', 'bar'])
  })
  it('handles empty fields', () => {
    expect(parseCsvRow('a,,c')).toEqual(['a', '', 'c'])
  })
})

describe('parseCsv', () => {
  it('parses a simple two-row CSV', () => {
    const { headers, rows } = parseCsv('title,desc\nFoo,Bar')
    expect(headers).toEqual(['title', 'desc'])
    expect(rows).toEqual([['Foo', 'Bar']])
  })
  it('keeps newlines inside quoted fields as one value', () => {
    const { rows } = parseCsv('title,desc\nFoo,"line one\nline two"')
    expect(rows[0][1]).toBe('line one\nline two')
  })
  it('handles CRLF line endings', () => {
    const { headers, rows } = parseCsv('a,b\r\n1,2\r\n3,4')
    expect(headers).toEqual(['a', 'b'])
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })
  it('handles escaped double-quotes inside quoted fields', () => {
    const { rows } = parseCsv('a,b\n"""quoted""",plain')
    expect(rows[0][0]).toBe('"quoted"')
  })
})
