import { describe, it, expect, afterEach } from 'vitest'
import { CsvWriter } from '../../src/infrastructure/csv/CsvWriter.js'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testFile = join(tmpdir(), `test-${Date.now()}.csv`)

afterEach(() => {
  if (existsSync(testFile)) rmSync(testFile)
})

describe('CsvWriter', () => {
  it('writes header and rows to CSV', async () => {
    const writer = new CsvWriter(testFile)
    await writer.write({ name: 'Alice', age: '30' })
    await writer.write({ name: 'Bob', age: '25' })
    await writer.close()

    const content = readFileSync(testFile, 'utf-8')
    expect(content).toContain('name,age')
    expect(content).toContain('Alice,30')
    expect(content).toContain('Bob,25')
  })

  it('appends rows on multiple writes without duplicating header', async () => {
    const writer = new CsvWriter(testFile)
    await writer.write({ x: '1' })
    await writer.write({ x: '2' })
    await writer.close()

    const lines = readFileSync(testFile, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
  })
})
