import { createWriteStream, existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { format } from 'fast-csv'

export class CsvWriter {
  private stream: ReturnType<typeof format> | null = null
  private headers: string[] | null = null
  private writeStream: ReturnType<typeof createWriteStream> | null = null

  constructor(private readonly filePath: string) {}

  async write(row: Record<string, string>): Promise<void> {
    if (!this.stream) {
      await mkdir(dirname(this.filePath), { recursive: true })
      this.writeStream = createWriteStream(this.filePath, { flags: 'a' })
      this.headers = Object.keys(row)
      this.stream = format({ headers: this.headers, includeEndRowDelimiter: true, writeBOM: false })
      this.stream.pipe(this.writeStream)
    }
    this.stream.write(row)
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
