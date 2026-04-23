import type { ParserConfig } from '../../domain/entities/Parser.js'

export interface IParserLoader {
  load(parserName: string): Promise<ParserConfig>
}
