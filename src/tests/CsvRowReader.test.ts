// src/tests/CsvRowReader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CsvRowReader } from '../infrastructure/csv/CsvRowReader.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csv-row-reader-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeCsvWithIndex(name: string, header: string, dataRows: string[]) {
  const lines = [header, ...dataRows].filter((l) => l.trim().length > 0)
  const content = lines.join('\n') + '\n'
  const filePath = join(dir, name)
  await writeFile(filePath, content)

  const index: Record<number, number> = {}
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    index[i] = offset
    offset += Buffer.byteLength(lines[i] + '\n', 'utf-8')
  }
  await writeFile(`${filePath}.index`, JSON.stringify(index))
  return filePath
}

describe('CsvRowReader', () => {
  it('returns the first page using the index', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a', '2,b', '3,c', '4,d', '5,e'])
    const out = await new CsvRowReader(file).readPage(1, 2)
    expect(out.headers).toEqual(['id', 'name'])
    expect(out.rows).toEqual([['1', 'a'], ['2', 'b']])
    expect(out.total).toBe(5)
    expect(out.pages).toBe(3)
    expect(out.page).toBe(1)
    expect(out.limit).toBe(2)
  })

  it('returns a middle page', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a', '2,b', '3,c', '4,d', '5,e'])
    const out = await new CsvRowReader(file).readPage(2, 2)
    expect(out.rows).toEqual([['3', 'c'], ['4', 'd']])
  })

  it('returns a partial last page', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a', '2,b', '3,c', '4,d', '5,e'])
    const out = await new CsvRowReader(file).readPage(3, 2)
    expect(out.rows).toEqual([['5', 'e']])
  })

  it('returns empty rows when the page is past the end', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a'])
    const out = await new CsvRowReader(file).readPage(99, 10)
    expect(out.rows).toEqual([])
    expect(out.total).toBe(1)
    expect(out.headers).toEqual(['id', 'name'])
  })

  it('falls back to streaming when the index file is missing', async () => {
    const file = join(dir, 'noindex.csv')
    await writeFile(file, 'id,name\n1,a\n2,b\n3,c\n4,d\n5,e\n')
    const out = await new CsvRowReader(file).readPage(1, 2)
    expect(out.headers).toEqual(['id', 'name'])
    expect(out.rows).toEqual([['1', 'a'], ['2', 'b']])
    expect(out.total).toBe(5)
    expect(out.pages).toBe(3)
  })

  it('falls back when the index file is malformed', async () => {
    const file = join(dir, 'bad.csv')
    await writeFile(file, 'id,name\n1,a\n2,b\n')
    await writeFile(`${file}.index`, 'not json at all')
    const out = await new CsvRowReader(file).readPage(1, 10)
    expect(out.total).toBe(2)
    expect(out.rows).toEqual([['1', 'a'], ['2', 'b']])
  })

  it('parses quoted fields with commas and escaped quotes', async () => {
    const file = await writeCsvWithIndex('q.csv', 'id,text', ['1,"a,b"', '2,"with ""quotes"""'])
    const out = await new CsvRowReader(file).readPage(1, 10)
    expect(out.rows).toEqual([
      ['1', 'a,b'],
      ['2', 'with "quotes"'],
    ])
  })

  it('handles a header-only CSV', async () => {
    const file = await writeCsvWithIndex('empty.csv', 'id,name', [])
    const out = await new CsvRowReader(file).readPage(1, 10)
    expect(out.headers).toEqual(['id', 'name'])
    expect(out.rows).toEqual([])
    expect(out.total).toBe(0)
    expect(out.pages).toBe(1)
  })

  it('clamps an oversized limit to MAX_LIMIT (1000)', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id', ['1', '2', '3'])
    const out = await new CsvRowReader(file).readPage(1, 99999)
    expect(out.limit).toBe(1000)
  })
})
