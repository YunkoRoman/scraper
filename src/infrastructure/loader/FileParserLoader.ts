import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParserConfig } from '../../domain/entities/Parser.js'

const isTsx = fileURLToPath(import.meta.url).endsWith('.ts')
const parserIndexFile = isTsx ? 'index.ts' : 'index.js'

export class FileParserLoader {
  constructor(private readonly parsersDir: string) {}

  async load(parserName: string): Promise<ParserConfig> {
    const filePath = resolve(this.parsersDir, parserName, parserIndexFile)
    const mod = await import(filePath)
    const config: ParserConfig = mod.default
    if (!config || !config.name) {
      throw new Error(`Parser "${parserName}" did not export a valid ParserConfig as default`)
    }
    // Return a copy — don't mutate the cached module default
    return { ...config, filePath }
  }
}
