import { readFile, writeFile } from 'node:fs/promises'

export class CsvPostProcessor {
  constructor(private readonly filePath: string) {}

  async process(): Promise<void> {
    await this.compress()
    await this.buildIndex()
  }

  private async compress(): Promise<void> {
    const content = await readFile(this.filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    await writeFile(this.filePath, lines.join('\n') + '\n')
  }

  private async buildIndex(): Promise<void> {
    const content = await readFile(this.filePath, 'utf-8')
    const lines = content.split('\n')
    const index: Record<number, number> = {}
    let offset = 0

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        index[i] = offset
      }
      offset += Buffer.byteLength(lines[i] + '\n', 'utf-8')
    }

    await writeFile(`${this.filePath}.index`, JSON.stringify(index, null, 2))
  }
}
