// src/infrastructure/csv/CsvRowReader.ts
import { open, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

export interface CsvRowsPage {
  headers: string[]
  rows: string[][]
  total: number
  page: number
  limit: number
  pages: number
}

const MAX_LIMIT = 1000

export class CsvRowReader {
  constructor(private readonly filePath: string) {}

  async readPage(page: number, limit: number): Promise<CsvRowsPage> {
    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || 20)))

    const indexPath = `${this.filePath}.index`
    let index: Record<string, number> | null = null
    try {
      const raw = await readFile(indexPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, number>
      if (parsed && typeof parsed === 'object') index = parsed
    } catch {
      index = null
    }

    if (index) return this.readWithIndex(index, safePage, safeLimit)
    return this.readWithoutIndex(safePage, safeLimit)
  }

  private async readWithIndex(
    index: Record<string, number>,
    page: number,
    limit: number,
  ): Promise<CsvRowsPage> {
    const keys = Object.keys(index).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
    if (keys.length === 0 || keys[0] !== 0) {
      return this.readWithoutIndex(page, limit)
    }
    const fileSize = (await stat(this.filePath)).size
    const total = Math.max(0, keys.length - 1)
    const pages = total === 0 ? 1 : Math.ceil(total / limit)

    const handle = await open(this.filePath, 'r')
    try {
      const headerStart = index[0] ?? 0
      const headerEnd = index[1] ?? fileSize
      const headers = await this.readLineAt(handle, headerStart, headerEnd)

      if (total === 0) {
        return { headers, rows: [], total: 0, page, limit, pages }
      }

      const startRow = (page - 1) * limit + 1
      const endRowExclusive = Math.min(startRow + limit, total + 1)

      if (startRow > total) {
        return { headers, rows: [], total, page, limit, pages }
      }

      const byteStart = index[startRow]
      const byteEnd = index[endRowExclusive] ?? fileSize
      const length = byteEnd - byteStart
      if (length <= 0) return { headers, rows: [], total, page, limit, pages }

      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, byteStart)
      const text = buf.toString('utf-8')
      const rows = text
        .split('\n')
        .filter((l) => l.length > 0)
        .map(parseCsvLine)

      return { headers, rows, total, page, limit, pages }
    } finally {
      await handle.close()
    }
  }

  private async readLineAt(
    handle: import('node:fs/promises').FileHandle,
    start: number,
    end: number,
  ): Promise<string[]> {
    const length = end - start
    if (length <= 0) return []
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, start)
    let s = buf.toString('utf-8')
    if (s.endsWith('\n')) s = s.slice(0, -1)
    return parseCsvLine(s)
  }

  private async readWithoutIndex(page: number, limit: number): Promise<CsvRowsPage> {
    const startRow = (page - 1) * limit + 1
    const endRowExclusive = startRow + limit

    let headers: string[] = []
    const rows: string[][] = []
    let total = 0
    let isFirst = true

    const stream = createReadStream(this.filePath, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    for await (const rawLine of rl) {
      if (rawLine.length === 0) continue
      if (isFirst) {
        headers = parseCsvLine(rawLine)
        isFirst = false
        continue
      }
      total += 1
      if (total >= startRow && total < endRowExclusive) {
        rows.push(parseCsvLine(rawLine))
      }
    }

    const pages = total === 0 ? 1 : Math.ceil(total / limit)
    return { headers, rows, total, page, limit, pages }
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else { inQuotes = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}
