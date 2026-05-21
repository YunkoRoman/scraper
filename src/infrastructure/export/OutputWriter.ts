import { CsvWriter } from '../csv/CsvWriter.js'
import { JsonWriter } from './JsonWriter.js'
import { ExcelWriter } from './ExcelWriter.js'

export type OutputFormat = 'csv' | 'json' | 'excel'

export interface OutputWriter {
  write(row: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

export function resolveOutputFileName(outputFile: string, format: OutputFormat): string {
  const base = outputFile.replace(/\.(csv|json|xlsx)$/i, '')
  if (format === 'json')  return `${base}.json`
  if (format === 'excel') return `${base}.xlsx`
  return `${base}.csv`
}

export function createOutputWriter(format: OutputFormat, filePath: string): OutputWriter {
  if (format === 'json')  return new JsonWriter(filePath)
  if (format === 'excel') return new ExcelWriter(filePath)
  return new CsvWriter(filePath)
}
