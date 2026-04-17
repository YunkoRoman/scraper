import { describe, it, expect, afterEach } from 'vitest'
import { CsvPostProcessor } from '../../src/infrastructure/csv/CsvPostProcessor.js'
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = tmpdir()
const csvFile = join(dir, `test-${Date.now()}.csv`)
const indexFile = `${csvFile}.index`

afterEach(() => {
  if (existsSync(csvFile)) rmSync(csvFile)
  if (existsSync(indexFile)) rmSync(indexFile)
})

describe('CsvPostProcessor', () => {
  it('creates an index file with byte offsets', async () => {
    writeFileSync(csvFile, 'name,age\nAlice,30\nBob,25\n')
    const processor = new CsvPostProcessor(csvFile)
    await processor.process()
    expect(existsSync(indexFile)).toBe(true)
    const index = JSON.parse(readFileSync(indexFile, 'utf-8'))
    expect(Object.keys(index).length).toBeGreaterThan(0)
  })

  it('removes empty lines during compression', async () => {
    writeFileSync(csvFile, 'name,age\nAlice,30\n\nBob,25\n\n')
    const processor = new CsvPostProcessor(csvFile)
    await processor.process()
    const content = readFileSync(csvFile, 'utf-8')
    expect(content).not.toMatch(/\n\n/)
  })
})
