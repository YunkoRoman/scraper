import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export class JsonWriter {
  private stream: ReturnType<typeof createWriteStream> | null = null
  private first = true

  constructor(private readonly filePath: string) {}

  async write(row: Record<string, unknown>): Promise<void> {
    if (!this.stream) {
      await mkdir(dirname(this.filePath), { recursive: true })
      this.stream = createWriteStream(this.filePath, { flags: 'w' })
      this.stream.write('[')
    }
    this.stream.write((this.first ? '' : ',') + JSON.stringify(row))
    this.first = false
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) { resolve(); return }
      this.stream.once('finish', resolve)
      this.stream.once('error', reject)
      this.stream.end(']')
    })
  }
}
