# 010 — JSON and Excel output formats via OutputWriter factory

## Background

Workers wrote extracted rows exclusively through `CsvWriter`. As the platform matured, users needed outputs that could be consumed directly by downstream tools: JSON for API pipelines and Excel for non-technical stakeholders. Both formats had to be selectable per step without touching the orchestrator's core logic.

## Problem

`CsvWriter` was hardcoded in `ParserOrchestrator.writeCsvRow()`. There was no abstraction point to select a different format, and no mechanism for a step to declare its desired output format. The `CsvPostProcessor` dedup pass was also CSV-specific and would fail silently if run against a non-CSV file path.

## Design

**`OutputWriter` interface** — defined in `src/infrastructure/export/OutputWriter.ts`:

```ts
interface OutputWriter {
  write(rows: Record<string, unknown>[]): Promise<void>;
  flush(): Promise<void>;
}
```

**Implementations:**

- `CsvWriter` — unchanged; streams rows via `fast-csv`.
- `JsonWriter` (`src/infrastructure/export/JsonWriter.ts`) — opens a write stream, emits `[` on first write, `,`-separated objects on subsequent writes, and `]` on `flush()`. Produces a valid JSON array without buffering all rows.
- `ExcelWriter` (`src/infrastructure/export/ExcelWriter.ts`) — uses `exceljs`; accumulates rows in memory, writes the `.xlsx` on `flush()`. Column headers are derived from the first row's keys.

**Factory** — `createOutputWriter(format, filePath)` in `src/infrastructure/export/index.ts` maps `'csv' | 'json' | 'excel'` to the corresponding implementation. `resolveOutputFileName(baseName, format)` appends the correct extension (`.csv`, `.json`, `.xlsx`).

**`ParserOrchestrator` changes:**

- `writeCsvRow()` renamed to `writeOutputRow()`.
- Reads `step.settings?.outputFormat` (defaults to `'csv'`) to select format via the factory.
- `runPostProcessing()` checks the format and skips `CsvPostProcessor` for non-CSV steps.

**`StepSettings` value object** — extended with `outputFormat?: 'csv' | 'json' | 'excel'`.

## Questions and Answers

- **Q1 — Why `exceljs` over the `xlsx` (SheetJS) package?** `exceljs` has a streaming write API (`WorkbookWriter`) for large datasets and is actively maintained under an MIT licence. `xlsx` community edition has had licence changes; `exceljs` is the safer long-term dependency.
- **Q2 — Why not support multiple simultaneous output formats per step?** YAGNI. A single format per step covers all current use cases. Multiple formats would require the orchestrator to manage a list of writers and call each on every row, adding complexity with no immediate benefit.
- **Q3 — Why buffer ExcelWriter rows in memory?** ExcelJS requires the worksheet to be fully populated before writing the XLSX binary. A streaming XLSX writer does not exist without switching to a lower-level library. Acceptable for the expected row counts; a future log entry should address this if datasets grow large.

## Trade-offs

| Decision | Trade-off |
|---|---|
| `ExcelWriter` buffers all rows | Memory usage is O(rows). Acceptable for typical scraping outputs (< 100k rows). Large datasets could cause OOM. |
| `JsonWriter` streams without buffering | Memory-efficient but produces non-pretty-printed JSON. Downstream consumers need to handle compact format. |
| `CsvPostProcessor` skipped for non-CSV | JSON/Excel files skip the dedup post-processing step. Users relying on post-processor dedup for non-CSV steps will not get it automatically. |
| `outputFormat` in `StepSettings` | Lives in the step's settings JSONB column; no DB schema change required. Validated at runtime by the factory; invalid values fall back to CSV. |

## Implementation Results

- `src/infrastructure/export/` directory created with `OutputWriter.ts`, `CsvWriter.ts` (moved), `JsonWriter.ts`, `ExcelWriter.ts`, and `index.ts` factory.
- `resolveOutputFileName` handles all three extensions correctly.
- `ParserOrchestrator.writeOutputRow()` wired to factory; `runPostProcessing` skips CSV post-processor for non-CSV formats.
- `StepSettings` extended with `outputFormat` field.
- `ExcelWriter.write()` correctly non-async (accumulates rows synchronously); only `flush()` is async.
- Unnecessary type cast for step `outputFile` removed during review.
- 3 unit tests pass (CSV unchanged, JSON array structure, Excel row count).
