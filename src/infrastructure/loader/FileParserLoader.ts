import { resolve } from 'node:path'
import type { ParserConfig } from '../../domain/entities/Parser.js'

export class FileParserLoader {
  constructor(private readonly parsersDir: string) {}

  async load(parserName: string): Promise<ParserConfig> {
    const path = resolve(this.parsersDir, parserName, 'index.ts')
    const module = await import(path)
    const config: ParserConfig = module.default
    if (!config || !config.name) {
      throw new Error(`Parser "${parserName}" did not export a valid ParserConfig as default`)
    }
    return config
  }
}
