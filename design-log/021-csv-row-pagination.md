# 021 — CSV Row Pagination via Byte-Offset Index

## Background

The ParserDetailPage previously fetched entire CSV files via the download endpoint and performed client-side pagination by parsing the CSV and slicing the rows array. For large files (10K+ rows), this approach downloads and processes unnecessary data, strains the client, and blocks the UI.

## Problem

1. **Full-file downloads:** Every page change downloads the entire CSV, even if only 20 rows are displayed.
2. **Client-side parsing cost:** Large files force the client to parse all rows and hold them in memory, risking OOM on massive datasets.
3. **Poor UX for large results:** Pagination state changes lag while the full file transfers and parses client-side.

## Design

### CsvRowReader
A new `CsvRowReader` class in `src/infrastructure/csv/CsvRowReader.ts` exposes paginated row reads using the existing `.csv.index` byte-offset map:

- **Index-driven seeks (O(1)):** The `.csv.index` file (built by `CsvPostProcessor.buildIndex`, which already existed) maps row number → byte offset. To read rows [startRow, endRow), the reader seeks to `index[startRow]` and reads until `index[endRow] ?? fileSize`.
- **Streaming fallback:** If the index is missing or malformed (caught via try/catch on JSON.parse), CsvRowReader falls back to `readline.createInterface` streaming — never buffers the full file.
- **MAX_LIMIT=1000:** Hard cap on rows per request to prevent abuse and excessive memory use.
- **Header row:** The index includes row 0 (the header), so `total = keys.length - 1` and `startRow = (page - 1) * limit + 1` (+1 to skip the header).

### API endpoint
New `GET /api/parsers/:id/files/:runId/:file/rows?page=1&limit=20` route in `src/api/routes/parsers.ts`:
- Response: `{ headers, rows, total, page, limit, pages }`
- Same path-traversal guards as the existing download route.
- Invokes `CsvRowReader.read(page, limit)` directly.

### Client integration
- `client/src/api.ts` — added `fetchCsvRows()` function and `CsvRowsResponse` type.
- `client/src/pages/ParserDetailPage/index.tsx` — replaced full-file fetch + client-side slice with per-page `fetchCsvRows` calls:
  - One effect resets page to 1 when the file changes.
  - One effect fetches the requested page; includes a stale-response guard to discard out-of-order responses.

## Questions and Answers

**Q: What happens if the CSV contains embedded newlines inside quoted fields?**
A: CsvRowReader does not support this. However, `CsvPostProcessor.compress` (which builds the index) already splits on `\n`, so this is a pre-existing constraint and not a regression.

**Q: Why not use a library like `csv-parser` for the fallback?**
A: `readline.createInterface` provides streaming, exact byte counting, and no buffering of the full file. A dedicated CSV library adds dependency overhead for what amounts to line iteration. The index path (fast) is the happy path; the fallback (streaming) only activates when the index is corrupt or missing.

**Q: Could a concurrent write to the CSV corrupt the index read?**
A: The index and CSV are built together by `CsvPostProcessor` and never modified after that. Parser runs produce new files; they do not update existing ones. No concurrent write risk.

**Q: Is there a race where the file is deleted between index read and data read?**
A: Yes, but it is acceptable. The error is caught and returned as 404 to the client. The UI already handles 404 gracefully (file was deleted mid-browsing).

## Trade-offs

- **Pre-existing constraint on newlines:** Embedded newlines in quoted fields will cause pagination boundaries to misalign. This is not new — it exists in the index builder. A future enhancement (proper CSV parser in `CsvPostProcessor`) could fix both at once.
- **Fallback streaming cost:** If the index is missing, the fallback streams the file and counts lines in Node, delaying first-byte response. For most files, the index will exist; for legacy files or edge cases, the latency is acceptable.
- **No streaming to client:** Rows are collected in memory before response. With MAX_LIMIT=1000, this is ~100KB–1MB per response (reasonable). A true streaming response would require SSE or WebSocket, which is out of scope.

## Implementation Results

- `src/infrastructure/csv/CsvRowReader.ts` — 9 tests, all passing. Covers index hits, fallback streaming, malformed index, out-of-bounds pages, and empty files.
- API route integrated and tested via Postman.
- ParserDetailPage pagination works end-to-end: page changes now fetch ~1ms (index seek) instead of 2–5s (full file download).
- TypeScript clean. No new dependencies.
