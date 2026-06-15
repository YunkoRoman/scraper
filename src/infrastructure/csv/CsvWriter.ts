import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { format } from 'fast-csv'

export class CsvWriter {
  private stream: ReturnType<typeof format> | null = null
  private headers: string[] | null = null
  private writeStream: ReturnType<typeof createWriteStream> | null = null
  private initPromise: Promise<void> | null = null

  constructor(private readonly filePath: string) {}

  private _init(firstRow: Record<string, string>): Promise<void> {
    return mkdir(dirname(this.filePath), { recursive: true }).then(() => {
      this.writeStream = createWriteStream(this.filePath, { flags: 'w' })
      this.headers = Object.keys(firstRow)
      this.stream = format({ headers: this.headers, includeEndRowDelimiter: true, writeBOM: false })
      this.stream.pipe(this.writeStream)
    })
  }

  async write(row: Record<string, unknown>): Promise<void> {
    const serialized = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v).replace(/\r?\n|\r/g, ' ')
            : String(v).replace(/\r?\n|\r/g, ' '),
      ]),
    )
    if (!this.initPromise) {
      this.initPromise = this._init(serialized)
    }
    await this.initPromise
    this.stream!.write(serialized)
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream || !this.writeStream) {
        resolve()
        return
      }
      this.writeStream.on('finish', resolve)
      this.writeStream.on('error', reject)
      this.stream.end()
    })
  }
}
