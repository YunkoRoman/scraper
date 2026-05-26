# Server-Side Paginated CSV Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop downloading entire CSV files to render 20 rows in the UI. Add a `GET /api/parsers/:id/files/:runId/:file/rows?page=1&limit=20` endpoint that uses the existing `.csv.index` byte-offset file to seek directly to the requested rows (O(1) seek per page). Switch `ParserDetailPage` to fetch paginated JSON instead of the full file. Fall back to a streaming full-file parse when the `.csv.index` is missing (older runs).

**Architecture:** A new `CsvRowReader` infrastructure class encapsulates the seeking logic — it reads the JSON index, opens the CSV with `fs.open`, computes a `[startOffset, endOffset)` window for the requested rows using the next-row offset (or EOF), reads only those bytes, and parses them as CSV. The existing CSV-download route is left untouched. The client's `ParserDetailPage` swaps client-side `.slice()` pagination for paginated fetches keyed on `csvPage`.

**Tech Stack:** TypeScript, Node.js built-ins (`fs/promises`, `node:fs`), Express, React 19, Vitest. **No new npm packages.**

---

## File Structure

**New files:**
- `src/infrastructure/csv/CsvRowReader.ts` — index-aware paginated CSV reader with full-file fallback
- `src/tests/CsvRowReader.test.ts` — unit tests covering both index path and fallback path
- `design-log/021-csv-row-pagination.md` — design log entry

**Modified files:**
- `src/api/routes/parsers.ts` — register new `/:id/files/:runId/:file/rows` route, register it **before** the existing `/:id/files/:runId/:file` route to avoid Express's `.csv/rows` being matched by the `:file` segment (it would not match — `:file` is a single segment — but order is safer and clearer)
- `client/src/api.ts` — add `fetchCsvRows` API client function and `CsvRowsResponse` type
- `client/src/pages/ParserDetailPage/index.tsx` — replace `fetchFileContent` + `parseCsv` + slice pagination with paginated `fetchCsvRows` per `csvPage` change
- `design-log/index.md` — append row 021

---

### Task 1: Implement `CsvRowReader`

**Files:**
- Create: `src/infrastructure/csv/CsvRowReader.ts`

The reader is a pure infrastructure utility. It does not know about Express or HTTP — it takes a CSV file path and a `(page, limit)` pair and returns parsed rows plus totals.

**Public shape:**

```ts
export interface CsvRowsPage {
  headers: string[]
  rows: string[][]
  total: number      // total *data* rows (excludes header)
  page: number       // echoed back (1-indexed)
  limit: number
  pages: number      // Math.ceil(total / limit), or 1 when total === 0
}

export class CsvRowReader {
  constructor(private readonly filePath: string) {}
  async readPage(page: number, limit: number): Promise<CsvRowsPage>
}
```

**Behavior:**

1. Normalize inputs: `page = Math.max(1, Math.floor(page))`, `limit = Math.max(1, Math.min(1000, Math.floor(limit)))`. A hard cap of 1000 prevents abusive requests.
2. Look for `{filePath}.csv.index` (i.e. append `.index` to the CSV path — `filePath` already ends in `.csv`).
3. **If the index exists:** parse it as `Record<string, number>`. Use the index path described below.
4. **If the index does NOT exist (or fails to parse):** fall back to a full-file read path described below.

#### Index path (the fast path)

Recall: the index is `{ "0": 0, "1": 47, "2": 273, ... }` where the key is the row number (string-encoded integer) and the value is the byte offset where that row *starts* in the file. Row `0` is the header. Data rows are keys `1, 2, 3, ...`.

Important: `CsvPostProcessor.buildIndex` writes an entry only for non-empty lines (it skips blank lines). In practice, after `compress()` runs, the only blank "line" is the trailing newline after the last data row, which has no entry. So the indexed keys are exactly `[0, 1, 2, ..., N]` for a file with `N` data rows.

Algorithm:

1. Read & `JSON.parse` the index file.
2. Sort the numeric keys ascending: `const keys = Object.keys(index).map(Number).sort((a, b) => a - b)`.
3. `total = keys.length - 1` (subtract 1 for the header row `0`). If `total < 0`, treat as `0`.
4. `pages = total === 0 ? 1 : Math.ceil(total / limit)`.
5. Compute the data-row range for the page:
   - `startRow = (page - 1) * limit + 1` (the `+ 1` skips the header)
   - `endRowExclusive = Math.min(startRow + limit, total + 1)` (the `+ 1` accounts for header offset)
6. If `startRow > total` (page past the end), return `{ headers, rows: [], total, page, limit, pages }` — but still read the header (next step).
7. Read the header line:
   - `headerStart = index[0]` (should be `0`)
   - `headerEnd = index[1] ?? <file size>` — read bytes `[headerStart, headerEnd)`, strip a trailing `\n`, parse as a CSV row, that's the header array.
   - If `index[1]` is undefined (file has no data rows), read from `headerStart` to EOF.
8. Read the page bytes:
   - `byteStart = index[startRow]`
   - `byteEnd = index[endRowExclusive] ?? <file size>` — when `endRowExclusive` is the row *after* the last data row and not in the index, fall back to file size (via `fstat`).
   - Use `fs.open(filePath, 'r')` → `fileHandle.read(buf, 0, length, byteStart)` where `length = byteEnd - byteStart`. Always `await fileHandle.close()` in a `finally` block.
9. Decode the buffer as UTF-8. Split on `\n`. Drop any trailing empty string from the final `\n`. Parse each line into a `string[]`.
10. Return `{ headers, rows, total, page, limit, pages }`.

**Helper: minimal CSV line parser.** The existing client `parseCsv` (in `client/src/pages/ParserDetailPage/index.tsx` line 42) handles quoted fields with embedded commas/quotes. Port the same single-line parser to the server. Do **not** import from the client.

```ts
// Parses one CSV line. Handles double-quoted fields and "" escapes.
// Does NOT handle embedded newlines inside quoted fields — CsvPostProcessor.compress
// splits on \n, so any embedded \n in CSV output would already break the index.
// (Confirm with: see CsvPostProcessor.compress, which assumes one record per line.)
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else { inQuotes = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}
```

#### Fallback path (no index)

When `{filePath}.csv.index` is missing or unreadable (older runs from before the index existed, or a partially-written run):

1. Stream the file line-by-line using `readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }) })`. Do **not** read the entire file into a string — large files would OOM the server.
2. The first non-empty line is the header (parse with `parseCsvLine`).
3. Subsequent non-empty lines are data rows. Count them as you go. Only push into the `rows` array when the 1-indexed data-row counter is in `[startRow, endRowExclusive)`.
4. After the stream ends, you have `total` (data row count) and the requested `rows` slice. Compute `pages` the same way as the index path.

This makes the fallback O(n) in file size — that's the cost of running on an unindexed file. It's still strictly better than the current behavior because nothing is buffered in memory beyond the page being returned.

- [ ] **Step 1: Write `src/infrastructure/csv/CsvRowReader.ts`**

```ts
// src/infrastructure/csv/CsvRowReader.ts
import { open, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

export interface CsvRowsPage {
  headers: string[]
  rows: string[][]
  total: number
  page: number
  limit: number
  pages: number
}

const MAX_LIMIT = 1000

export class CsvRowReader {
  constructor(private readonly filePath: string) {}

  async readPage(page: number, limit: number): Promise<CsvRowsPage> {
    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || 20)))

    const indexPath = `${this.filePath}.index`
    let index: Record<string, number> | null = null
    try {
      const raw = await readFile(indexPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, number>
      if (parsed && typeof parsed === 'object') index = parsed
    } catch {
      index = null
    }

    if (index) return this.readWithIndex(index, safePage, safeLimit)
    return this.readWithoutIndex(safePage, safeLimit)
  }

  private async readWithIndex(
    index: Record<string, number>,
    page: number,
    limit: number,
  ): Promise<CsvRowsPage> {
    const keys = Object.keys(index).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
    if (keys.length === 0 || keys[0] !== 0) {
      // Malformed index — fall back to streaming.
      return this.readWithoutIndex(page, limit)
    }
    const fileSize = (await stat(this.filePath)).size
    const total = Math.max(0, keys.length - 1) // exclude header row 0
    const pages = total === 0 ? 1 : Math.ceil(total / limit)

    const handle = await open(this.filePath, 'r')
    try {
      // Read header
      const headerStart = index[0] ?? 0
      const headerEnd = index[1] ?? fileSize
      const headers = await this.readLineAt(handle, headerStart, headerEnd)

      // Empty file
      if (total === 0) {
        return { headers, rows: [], total: 0, page, limit, pages }
      }

      const startRow = (page - 1) * limit + 1 // +1 skips header
      const endRowExclusive = Math.min(startRow + limit, total + 1)

      if (startRow > total) {
        return { headers, rows: [], total, page, limit, pages }
      }

      const byteStart = index[startRow]
      const byteEnd = index[endRowExclusive] ?? fileSize
      const length = byteEnd - byteStart
      if (length <= 0) return { headers, rows: [], total, page, limit, pages }

      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, byteStart)
      const text = buf.toString('utf-8')
      const rows = text
        .split('\n')
        .filter((l) => l.length > 0)
        .map(parseCsvLine)

      return { headers, rows, total, page, limit, pages }
    } finally {
      await handle.close()
    }
  }

  private async readLineAt(
    handle: import('node:fs/promises').FileHandle,
    start: number,
    end: number,
  ): Promise<string[]> {
    const length = end - start
    if (length <= 0) return []
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, start)
    // Strip the trailing newline if present.
    let s = buf.toString('utf-8')
    if (s.endsWith('\n')) s = s.slice(0, -1)
    return parseCsvLine(s)
  }

  private async readWithoutIndex(page: number, limit: number): Promise<CsvRowsPage> {
    const startRow = (page - 1) * limit + 1
    const endRowExclusive = startRow + limit

    let headers: string[] = []
    const rows: string[][] = []
    let total = 0
    let isFirst = true

    const stream = createReadStream(this.filePath, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    for await (const rawLine of rl) {
      if (rawLine.length === 0) continue
      if (isFirst) {
        headers = parseCsvLine(rawLine)
        isFirst = false
        continue
      }
      total += 1
      if (total >= startRow && total < endRowExclusive) {
        rows.push(parseCsvLine(rawLine))
      }
    }

    const pages = total === 0 ? 1 : Math.ceil(total / limit)
    return { headers, rows, total, page, limit, pages }
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else { inQuotes = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/csv/CsvRowReader.ts
git commit -m "feat(csv): add CsvRowReader for index-based paginated reads"
```

---

### Task 2: Unit tests for `CsvRowReader`

**Files:**
- Create: `src/tests/CsvRowReader.test.ts`

Test layout: create a temp directory in `os.tmpdir()`, write a CSV + its `.csv.index` by hand, and assert on the reader's output. Use Vitest's `beforeEach`/`afterEach` to make and clean up the temp dir.

Cases to cover:

1. **Indexed read, first page** — 5 data rows, page=1, limit=2 → returns header, rows 1–2, total=5, pages=3.
2. **Indexed read, middle page** — same file, page=2, limit=2 → rows 3–4.
3. **Indexed read, last partial page** — same file, page=3, limit=2 → 1 row (row 5).
4. **Indexed read, page past end** — page=99 → empty rows, but total/pages still correct and headers still populated.
5. **Fallback when index missing** — write CSV but no `.csv.index`. Same assertions as Case 1.
6. **Fallback when index file is malformed** — write garbage to `.csv.index`. Must fall back, not throw.
7. **Quoted fields** — a row contains `"a,b"` and `"with ""quotes"""`. Returned rows match the expected post-parse strings.
8. **Empty data file** — header-only CSV with index `{ "0": 0 }`. `total=0`, `pages=1`, `rows=[]`, headers populated.
9. **Limit clamp** — pass `limit=99999`; verify the reader caps to `MAX_LIMIT=1000` (assert returned `limit === 1000`).

- [ ] **Step 1: Write the test file**

```ts
// src/tests/CsvRowReader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CsvRowReader } from '../infrastructure/csv/CsvRowReader.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csv-row-reader-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeCsvWithIndex(name: string, header: string, dataRows: string[]) {
  // Reproduce the same compress+buildIndex behavior CsvPostProcessor uses:
  // - drop empty lines
  // - join with \n
  // - trailing \n
  // - index = { rowNumber: byteOffset } for each non-empty line
  const lines = [header, ...dataRows].filter((l) => l.trim().length > 0)
  const content = lines.join('\n') + '\n'
  const filePath = join(dir, name)
  await writeFile(filePath, content)

  const index: Record<number, number> = {}
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    index[i] = offset
    offset += Buffer.byteLength(lines[i] + '\n', 'utf-8')
  }
  await writeFile(`${filePath}.index`, JSON.stringify(index))
  return filePath
}

describe('CsvRowReader', () => {
  it('returns the first page using the index', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a', '2,b', '3,c', '4,d', '5,e'])
    const out = await new CsvRowReader(file).readPage(1, 2)
    expect(out.headers).toEqual(['id', 'name'])
    expect(out.rows).toEqual([['1', 'a'], ['2', 'b']])
    expect(out.total).toBe(5)
    expect(out.pages).toBe(3)
    expect(out.page).toBe(1)
    expect(out.limit).toBe(2)
  })

  it('returns a middle page', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a', '2,b', '3,c', '4,d', '5,e'])
    const out = await new CsvRowReader(file).readPage(2, 2)
    expect(out.rows).toEqual([['3', 'c'], ['4', 'd']])
  })

  it('returns a partial last page', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a', '2,b', '3,c', '4,d', '5,e'])
    const out = await new CsvRowReader(file).readPage(3, 2)
    expect(out.rows).toEqual([['5', 'e']])
  })

  it('returns empty rows when the page is past the end', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id,name', ['1,a'])
    const out = await new CsvRowReader(file).readPage(99, 10)
    expect(out.rows).toEqual([])
    expect(out.total).toBe(1)
    expect(out.headers).toEqual(['id', 'name'])
  })

  it('falls back to streaming when the index file is missing', async () => {
    const file = join(dir, 'noindex.csv')
    await writeFile(file, 'id,name\n1,a\n2,b\n3,c\n4,d\n5,e\n')
    const out = await new CsvRowReader(file).readPage(1, 2)
    expect(out.headers).toEqual(['id', 'name'])
    expect(out.rows).toEqual([['1', 'a'], ['2', 'b']])
    expect(out.total).toBe(5)
    expect(out.pages).toBe(3)
  })

  it('falls back when the index file is malformed', async () => {
    const file = join(dir, 'bad.csv')
    await writeFile(file, 'id,name\n1,a\n2,b\n')
    await writeFile(`${file}.index`, 'not json at all')
    const out = await new CsvRowReader(file).readPage(1, 10)
    expect(out.total).toBe(2)
    expect(out.rows).toEqual([['1', 'a'], ['2', 'b']])
  })

  it('parses quoted fields with commas and escaped quotes', async () => {
    const file = await writeCsvWithIndex('q.csv', 'id,text', ['1,"a,b"', '2,"with ""quotes"""'])
    const out = await new CsvRowReader(file).readPage(1, 10)
    expect(out.rows).toEqual([
      ['1', 'a,b'],
      ['2', 'with "quotes"'],
    ])
  })

  it('handles a header-only CSV', async () => {
    const file = await writeCsvWithIndex('empty.csv', 'id,name', [])
    const out = await new CsvRowReader(file).readPage(1, 10)
    expect(out.headers).toEqual(['id', 'name'])
    expect(out.rows).toEqual([])
    expect(out.total).toBe(0)
    expect(out.pages).toBe(1)
  })

  it('clamps an oversized limit to MAX_LIMIT (1000)', async () => {
    const file = await writeCsvWithIndex('a.csv', 'id', ['1', '2', '3'])
    const out = await new CsvRowReader(file).readPage(1, 99999)
    expect(out.limit).toBe(1000)
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/tests/CsvRowReader.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/CsvRowReader.test.ts
git commit -m "test(csv): cover CsvRowReader indexed and fallback paths"
```

---

### Task 3: Add the `/rows` API endpoint

**Files:**
- Modify: `src/api/routes/parsers.ts`

Register a new route directly **before** the existing single-file download route (line 313 in current source). Even though Express's `:file` would not match `something.csv/rows` (each `:param` is one segment), keeping the more specific route earlier is the conventional pattern in this file.

- [ ] **Step 1: Add the import**

At the top of `src/api/routes/parsers.ts`, add:

```ts
import { CsvRowReader } from '../../infrastructure/csv/CsvRowReader.js'
```

(Path may need to be adjusted if the file's relative depth differs — confirm with the other imports already in that file.)

- [ ] **Step 2: Insert the new route handler immediately before the existing `router.get('/:id/files/:runId/:file', ...)` block**

```ts
router.get('/:id/files/:runId/:file/rows', async (req, res) => {
  const { name }: ParserRow = res.locals.parser
  const { runId, file } = req.params

  // Same path-traversal guards as the download route.
  if (!file.endsWith('.csv')) {
    res.status(400).json({ error: 'Row pagination is only supported for CSV files' })
    return
  }
  if (file.includes('/') || file.includes('..') || runId.includes('/') || runId.includes('..')) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  const safeDir = resolve(outputDir, name)
  const filePath = resolve(safeDir, runId, file)
  if (!filePath.startsWith(safeDir + '/')) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1
  const limit = Number.parseInt(String(req.query.limit ?? '20'), 10) || 20

  try {
    const reader = new CsvRowReader(filePath)
    const result = await reader.readPage(page, limit)
    res.json(result)
  } catch (err) {
    console.error('[parsers/rows] failed to read CSV page:', err)
    res.status(500).json({ error: 'Failed to read CSV rows' })
  }
})
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run api:dev
```

In another shell, pick a parser with a finished run and an existing CSV (use `ls output/<parser-name>/<run-id>/`):

```bash
curl "http://localhost:3001/api/parsers/<parser-name>/files/<run-id>/<step>.csv/rows?page=1&limit=5" | jq .
```

Expected: JSON with `headers`, `rows` (5 items max), `total`, `page=1`, `limit=5`, `pages`.

Also test fallback by temporarily renaming the `.csv.index` file:

```bash
mv output/<parser>/<run>/<step>.csv.index output/<parser>/<run>/<step>.csv.index.bak
curl "http://localhost:3001/api/parsers/<parser>/files/<run>/<step>.csv/rows?page=1&limit=5" | jq .
mv output/<parser>/<run>/<step>.csv.index.bak output/<parser>/<run>/<step>.csv.index
```

Expected: identical output (slower for large files).

Also test traversal guards:

```bash
curl -i "http://localhost:3001/api/parsers/<parser>/files/..%2F..%2Fetc/passwd/rows?page=1"
```

Expected: HTTP 400.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/parsers.ts
git commit -m "feat(api): add paginated CSV rows endpoint backed by byte-offset index"
```

---

### Task 4: Add `fetchCsvRows` client API function

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add the type and the function**

Append to `client/src/api.ts` (near `fetchFileContent`):

```ts
export interface CsvRowsResponse {
  headers: string[]
  rows: string[][]
  total: number
  page: number
  limit: number
  pages: number
}

export async function fetchCsvRows(
  parserId: string,
  runId: string,
  fileName: string,
  page: number,
  limit: number,
): Promise<CsvRowsResponse> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) })
  const res = await fetch(
    `${API_BASE}/api/parsers/${parserId}/files/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}/rows?${q}`,
  )
  if (!res.ok) throw new Error(`Failed to fetch CSV rows: ${res.status}`)
  return res.json() as Promise<CsvRowsResponse>
}
```

- [ ] **Step 2: Typecheck the client**

```bash
npx tsc --noEmit -p client
```

(If the client has its own tsconfig path, adapt — the project uses Vite + React 19 so `npm run build` would also exercise this.)

- [ ] **Step 3: Commit**

```bash
git add client/src/api.ts
git commit -m "feat(client): add fetchCsvRows API function for paginated CSV reads"
```

---

### Task 5: Refactor `ParserDetailPage` to use server-side pagination

**Files:**
- Modify: `client/src/pages/ParserDetailPage/index.tsx`

The current page (lines 115–165) downloads the whole file once, parses it with the in-file `parseCsv` helper, stores `{ headers, rows }` in `csvData`, and slices client-side. We replace this with a fetch-per-page model.

- [ ] **Step 1: Update imports**

Replace `fetchFileContent` with `fetchCsvRows` (and import the `CsvRowsResponse` type):

```ts
import {
  // …existing imports, drop fetchFileContent…
  fetchCsvRows,
  type CsvRowsResponse,
} from '../../api'
```

- [ ] **Step 2: Replace state**

Remove:

```ts
const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null)
```

Add:

```ts
const CSV_PER_PAGE = 20
const [csvPage, setCsvPage] = useState(1)
const [csvData, setCsvData] = useState<CsvRowsResponse | null>(null)
const [csvLoading, setCsvLoading] = useState(false)
```

(Keep `csvLoading` and `csvPage` — they already exist.)

- [ ] **Step 3: Drop the client-side `parseCsv` helper**

The `function parseCsv(text: string)` block at line 42 in the current file is no longer used. Delete it.

- [ ] **Step 4: Replace the effect that loaded the file**

Replace the existing `useEffect` (current lines ~162–170) with two effects:

```ts
// When a file is selected, reset to page 1.
useEffect(() => {
  setCsvPage(1)
  setCsvData(null)
}, [selectedFile])

// Whenever the file or page changes, fetch that page.
useEffect(() => {
  if (!selectedFile) return
  if (!selectedFile.name.endsWith('.csv')) {
    setCsvData(null)
    return
  }
  let cancelled = false
  setCsvLoading(true)
  fetchCsvRows(parserId, selectedFile.runId, selectedFile.name, csvPage, CSV_PER_PAGE)
    .then((data) => { if (!cancelled) setCsvData(data) })
    .catch(() => { if (!cancelled) setCsvData(null) })
    .finally(() => { if (!cancelled) setCsvLoading(false) })
  return () => { cancelled = true }
}, [parserId, selectedFile, csvPage])
```

The `cancelled` flag prevents an out-of-order response from a previous page overwriting the current page when the user clicks Next quickly.

- [ ] **Step 5: Update the render block**

In the JSX (around lines 403–455), replace the slice-and-compute block with values from the server response. The control variables become:

```tsx
const pageRows = csvData.rows
const csvTotalPages = csvData.pages
const totalRows = csvData.total
const startIdx = (csvData.page - 1) * csvData.limit + 1
const endIdx = Math.min(csvData.page * csvData.limit, totalRows)
```

Update the "X–Y of Z rows" label:

```tsx
{totalRows === 0 ? 'No rows' : `${startIdx}–${endIdx} of ${totalRows} rows`}
```

Keep the existing prev/next buttons but bind them to `csvData.pages` and `csvData.page`:

```tsx
<button disabled={csvData.page === 1} onClick={() => setCsvPage((p) => Math.max(1, p - 1))}>Prev</button>
<button disabled={csvData.page >= csvData.pages} onClick={() => setCsvPage((p) => p + 1)}>Next</button>
```

Update the "no data" guard so it correctly distinguishes loading vs empty vs no-file:

```tsx
{csvLoading ? (
  <Spinner />
) : !csvData || csvData.headers.length === 0 ? (
  <div className="empty-state">No CSV preview available.</div>
) : (
  <>
    {/* table + pagination using pageRows / csvData.pages / csvData.page */}
  </>
)}
```

- [ ] **Step 6: Manual UI smoke**

```bash
npm run start
```

Open the parser detail page in the browser, pick a CSV with > 20 rows. Verify:

- The first 20 rows display.
- "1–20 of N rows" reads correctly.
- Clicking Next loads rows 21–40 (Network tab shows a `/rows?page=2&limit=20` call returning JSON, NOT the whole file).
- Clicking Prev returns to page 1.
- A CSV from a run *without* a `.csv.index` (temporarily rename it as above) still works.

- [ ] **Step 7: Typecheck the client**

```bash
npx tsc --noEmit -p client
```

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/ParserDetailPage/index.tsx
git commit -m "feat(client): use server-side CSV pagination in ParserDetailPage"
```

---

### Task 6: Design log entry

**Files:**
- Create: `design-log/021-csv-row-pagination.md`
- Modify: `design-log/index.md`

- [ ] **Step 1: Write the log**

Sections (match the format of the other entries): **Background**, **Problem**, **Design**, **Questions and Answers**, **Trade-offs**, **Implementation Results**.

Cover:

- **Background** — `.csv.index` already exists, built by `CsvPostProcessor.buildIndex` (introduced earlier; mention which log if any). The frontend was downloading the entire CSV to show 20 rows.
- **Problem** — at 100k+ rows the CSV download is multi-MB, parsing blocks the main thread, and the network transfer dominates wall-clock for first paint.
- **Design** — new `CsvRowReader` infrastructure class; new `/files/:runId/:file/rows` endpoint. The index gives an exact byte window per page so we use `fs.open` + `fileHandle.read(buf, 0, length, offset)`. Fallback path uses `readline` so we never buffer the full file. `total = keys.length - 1` because key `0` is the header.
- **Q&A** — Why not stream all data rows? Because the client only renders 20 at a time; transferring the rest is wasted bandwidth. Why a hard `MAX_LIMIT=1000`? Prevents abusive callers from defeating pagination. Why is the fallback still O(n)? Because there is no index to seek with; it is still strictly better than the old behavior because nothing is buffered.
- **Trade-offs** — CSV with embedded newlines inside quoted fields is unsupported (also unsupported by the index itself; `CsvPostProcessor.compress` already splits on `\n`). The reader opens the file once per request — no caching layer yet; can be added later if hot files become a hotspot.
- **Implementation Results** — list the files added/modified and the test count from Task 2.

- [ ] **Step 2: Append a row to `design-log/index.md`**

Add the row beneath entry 020:

```markdown
| 021 | [CSV row pagination via byte-offset index](021-csv-row-pagination.md) | completed | New CsvRowReader uses the existing .csv.index to seek to the requested page in O(1), exposed via GET /api/parsers/:id/files/:runId/:file/rows. Streaming fallback when the index is missing. ParserDetailPage swapped from full-file download + client slice to per-page fetch. |
```

- [ ] **Step 3: Commit**

```bash
git add design-log/021-csv-row-pagination.md design-log/index.md
git commit -m "docs(design-log): record CSV row pagination via byte-offset index"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npm run test -- --run
```

Expected: all green including the new `CsvRowReader` suite.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean TypeScript build.

- [ ] **Step 3: End-to-end check**

```bash
npm run start
```

Open `http://localhost:5173`, navigate to a parser detail page with a large CSV, and verify in DevTools Network that:

- The initial CSV view loads via a single `/rows?page=1&limit=20` request returning a small JSON payload (< 50 KB typical).
- Clicking pages issues exactly one new `/rows` request per click.
- The browser never downloads the full `.csv`.
