import ExcelJS from 'exceljs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export class ExcelWriter {
  private workbook = new ExcelJS.Workbook()
  private sheet = this.workbook.addWorksheet('rows')
  private headers: string[] | null = null

  constructor(private readonly filePath: string) {}

  write(row: Record<string, unknown>): Promise<void> {
    if (!this.headers) {
      this.headers = Object.keys(row)
      this.sheet.columns = this.headers.map((h) => ({ header: h, key: h }))
    }
    const serialized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      serialized[k] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v
    }
    this.sheet.addRow(serialized)
    return Promise.resolve()
  }

  async close(): Promise<void> {
    if (!this.headers) return
    await mkdir(dirname(this.filePath), { recursive: true })
    await this.workbook.xlsx.writeFile(this.filePath)
  }
}
