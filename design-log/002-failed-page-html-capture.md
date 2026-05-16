# 002 — Failed page HTML capture

## Background

When a page job fails the operator sees only the error message (e.g. `TimeoutError`, `selector not found`). That is often not enough to diagnose the root cause — the site may have returned a CAPTCHA, a 429 rate-limit page, a bot-detection wall, or a completely different layout than expected. The raw HTML the browser received at the moment of failure is the most direct evidence.

## Problem

Capture and surface the HTML the browser held at the time a page job fails, so it is visible in the Task Detail page without requiring the operator to re-run the parser with manual inspection.

Constraints:

- HTML must survive the browser page being closed (`page.close()` runs in `finally`).
- HTML should only be persisted once a task is **permanently failed** (all retry attempts exhausted), not on every transient attempt.
- Must not break the existing `taskResults` contract for successful extractor tasks.
- Must not require a DB schema migration.

## Questions and Answers

- **Q1 — Where to capture?** In the worker's `catch` block, before `page.close()` in `finally`. Both `TraverserWorker` and `ExtractorWorker` are symmetric so both get the same treatment.
- **Q2 — How to transmit to the orchestrator?** Add an optional `html?: string` field to the existing `PAGE_FAILED` worker-out message. Keeps the message bus self-contained.
- **Q3 — When to persist?** Only after all retries are exhausted. The orchestrator holds the latest HTML in a `Map<taskId, html>` and emits a `task_failed_html` event only in the final-failure branch.
- **Q4 — Where to store?** Reuse the existing `taskResults` table with a sentinel row `[{ __failedHtml: '<html>…' }]`. No migration needed; JSONB accepts any shape.
- **Q5 — API?** The existing `GET /api/jobs/:runId/tasks/:taskId/result` endpoint already returns `taskResults`. No new endpoint.
- **Q6 — What if `page.content()` itself throws?** Wrapped in `.catch(() => undefined)`. HTML is best-effort; a missing page (e.g. browser crashed) just produces no HTML rather than masking the original error.
- **Q7 — HTML size?** Pages can be 1–5 MB. Stored as TEXT in JSONB, which Postgres handles without issue at this scale. No truncation for now.

## Design

### Message bus change

```ts
// messages.ts — WorkerOutMessage
| { type: 'PAGE_FAILED'; taskId: string; error: string; html?: string }
```

### Worker change (identical in both TraverserWorker and ExtractorWorker)

```ts
} catch (err) {
  const html = await page.content().catch(() => undefined)
  parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err), html })
}
```

### Orchestrator change

```ts
private taskHtml = new Map<string, string>()

// In PAGE_FAILED handler:
if (msg.html) this.taskHtml.set(msg.taskId, msg.html)
// …retry logic…
// Final-failure branch only:
const html = this.taskHtml.get(msg.taskId)
if (html) {
  this.emit('task_failed_html', msg.taskId, html)
  this.taskHtml.delete(msg.taskId)   // free memory
}
this.emit('task_done', task)
```

The map stores only the **latest** HTML per task (a retry may land on a different error page than the first attempt; the last one is most relevant).

### ParserRunnerService change

```ts
orchestrator.on('task_failed_html', (taskId: string, html: string) => {
  this.runPersistence.saveTaskResult(taskId, [{ __failedHtml: html }]).catch(console.error)
})
```

### UI change (TaskDetailPage)

For failed tasks, `getTaskResult` is called. If the result contains a row with `__failedHtml`, it is rendered in a collapsible `<details>` block:

- Header shows file size (`x.x KB`) to give a quick sense of the response.
- `Copy` button writes raw HTML to the clipboard.
- `max-h-96 overflow-y-auto` limits the visible area so the page does not become unscrollable.
- A fallback message is shown when no HTML was captured (tasks that failed before this feature shipped).

## Trade-offs

- **Reusing `taskResults` vs new column/table**: avoids a migration; the sentinel key `__failedHtml` is unambiguous. Downside: a reader querying `taskResults` for extractor output needs to filter it out — acceptable because the API and UI already distinguish by `task.state`.
- **Latest HTML only**: discards HTML from intermediate retry attempts. A retried request often lands on the same blocking page so the last capture is representative. Storing per-attempt HTML would require a new table.
- **In-memory `taskHtml` map**: lives for the duration of the run. For very large runs with many failures this holds multiple large strings simultaneously. Acceptable at current scale; could be evicted after `saveTaskResult` confirms write (not done — async save race not worth the complexity).
- **No truncation**: keeping full HTML avoids silently hiding the part that contains the bot-detection signal (often in a `<script>` block deep in the body).

## Implementation Results

Implemented in a single session across five files:

- `src/infrastructure/worker/messages.ts` — `html?` field on `PAGE_FAILED`
- `src/infrastructure/worker/TraverserWorker.ts` — `page.content()` capture in catch
- `src/infrastructure/worker/ExtractorWorker.ts` — same
- `src/application/orchestrator/ParserOrchestrator.ts` — `taskHtml` map, `task_failed_html` emit
- `src/application/services/ParserRunnerService.ts` — `task_failed_html` → `saveTaskResult`
- `client/src/components/TaskDetailPage.tsx` — collapsible HTML viewer for failed tasks

No DB migration required. `tsc --noEmit` clean.
