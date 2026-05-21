# 014 — Webhook notifications

## Background

When a parser run completed or stopped, the only way a downstream system could know was by polling `GET /api/parsers/:name/status`. Users integrating the scraper into larger pipelines — triggering post-processing, sending alerts, or kicking off data ingestion — had to implement polling loops externally.

## Problem

No push notification existed for run lifecycle events. External systems could not be notified of completion or stop without continuous polling. There was also no persistent configuration surface for webhook URLs; they would need to be added to the parser DB record.

## Design

**DB — `webhookUrl` column** (migration `0005_webhook_url.sql`):

- `webhookUrl text` (nullable) added to the `parsers` table.
- `ParserPersistenceService` `create` and `update` methods extended to accept and persist `webhookUrl`.

**`WebhookService`** (`src/infrastructure/webhook/WebhookService.ts`):

- Single `fire(url, payload)` method using the Node 18 native `fetch` API.
- Posts `Content-Type: application/json` with a `WebhookPayload` body.
- Errors are caught and logged; delivery is best-effort (no retry).

**`WebhookPayload`** type:

```ts
interface WebhookPayload {
  event:      'complete' | 'stopped' | 'error'
  parserName: string
  runId:      string | null
  stats:      RunStats | null
  timestamp:  string
}
```

**`server.ts` — event wiring:**

- `runner.on('complete', ...)` — broadcasts SSE, then loads the parser via `parserService.getParserByName` and calls `webhookService.fire` if `webhookUrl` is set.
- `runner.on('stopped', ...)` — same pattern; includes current stats via `runner.getStats`.
- Both calls are fire-and-forget (`void`) so webhook latency never delays the runner event pipeline.

**API** — `webhookUrl` accepted in `PUT /api/parsers/:id` body; no dedicated webhook routes.

**`ParserSettingsPanel`** — text input for webhook URL added alongside existing settings.

## Questions and Answers

- **Q1 — Why no retry on webhook delivery failure?** Retries require persistent state (delivery log, backoff tracking). For the current scale, best-effort delivery is acceptable. If reliability is needed, a future log entry should introduce a delivery queue with exponential backoff.
- **Q2 — Why not validate the URL on save?** The URL field accepts any string to allow internal addresses (e.g. `http://localhost:8080/hook`) that would fail DNS-based validation. Delivery failure is logged server-side if the URL is invalid.
- **Q3 — Why store `webhookUrl` on the parser rather than in a separate `webhooks` table?** One webhook per parser is the common case. A dedicated table would add join complexity for a 1:1 relationship. A many-webhooks-per-parser model can be added later without breaking the current API.
- **Q4 — Why wire events in `server.ts` rather than inside `ParserRunnerService`?** The runner is an application-layer service with no knowledge of the webhook infrastructure. Wiring in `server.ts` keeps the webhook concern in the infrastructure/delivery layer without polluting the runner's event contract.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Best-effort delivery, no retry | Simple. Loses events if the target server is temporarily down. |
| Single URL per parser | Cannot fan-out to multiple receivers without an external relay. |
| `runId: null` in payload | The runner emits by parser name, not run ID. Recovering the run ID at webhook-fire time would require an extra DB query. Omitted as a known limitation. |
| Native `fetch` (no axios) | Requires Node 18+. Removes one dependency. Not available in worker threads (only used in the main process). |

## Implementation Results

- `webhookUrl` column added to `parsers` table via migration `0005_webhook_url.sql`.
- `WebhookService` implemented; unit tests cover successful fire and error swallowing.
- `runner.on('complete')` and `runner.on('stopped')` event handlers in `server.ts` wired to `WebhookService.fire`.
- `ParserPersistenceService` create/update extended for `webhookUrl`.
- `ParserSettingsPanel` webhook URL input added.
- Build passes; manual test: local `http.createServer` log endpoint received `complete` payload after run finished.
