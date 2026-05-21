import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createOutputWriter } from '../infrastructure/export/OutputWriter.js'

describe('createOutputWriter', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(resolve(tmpdir(), 'out-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('writes JSON file with array of rows', async () => {
    const w = createOutputWriter('json', resolve(dir, 'out.json'))
    await w.write({ a: 1 })
    await w.write({ a: 2 })
    await w.close()
    const text = await readFile(resolve(dir, 'out.json'), 'utf8')
    expect(JSON.parse(text)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('writes Excel xlsx file with header row', async () => {
    const w = createOutputWriter('excel', resolve(dir, 'out.xlsx'))
    await w.write({ title: 'A', n: 1 })
    await w.write({ title: 'B', n: 2 })
    await w.close()
    const buf = await readFile(resolve(dir, 'out.xlsx'))
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('writes CSV when format is csv', async () => {
    const w = createOutputWriter('csv', resolve(dir, 'out.csv'))
    await w.write({ x: 1 })
    await w.close()
    const text = await readFile(resolve(dir, 'out.csv'), 'utf8')
    expect(text.startsWith('x')).toBe(true)
  })
})
