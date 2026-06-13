# 023 — Full-codebase security, concurrency, and DDD audit hardening

**Status:** completed

## Background

After the auth implementation (022), four custom review agents ran a full-codebase pass: `ddd-boundary-reviewer`, `security-reviewer`, `concurrency-reviewer`, and `worker-protocol-reviewer`. The platform was now multi-file, multi-worker, and auth-aware, making it the right moment for a deep audit before the first real deployment.

## Problem

The audit surfaced 56 findings across four categories:

- **Security** — path traversal via `outputFile`, SSRF in webhook and `entryUrl`, unsandboxed user-supplied code execution, header injection in `Content-Disposition`, ILIKE wildcard injection, JWT secret enforcement gaps, plaintext error leakage in production, missing rate limiting and security headers, XSS bridge via `page.exposeFunction`, no per-org parser isolation.
- **Concurrency** — `globalActive` quota bypass (increment deferred past two `await` boundaries), double-decrement from concurrent PAGE_SUCCESS/PAGE_FAILED, `checkCompletion` double-resolution, `retryTask` non-atomic TOCTOU, premature run completion while LINKS_DISCOVERED handlers still in flight, per-task `mutate()` read-modify-write races in `DbTaskStateStore`, `TaskWriteBuffer` discarding failed writes, `ParserRunnerService` TOCTOU on concurrent run starts.
- **Worker protocol** — workers silently dropping PROCESS_PAGE after STOP, missing `default: never` exhaustiveness in both message switches, `__workerPath` in `WorkerData` missing from the type union.
- **DDD layering** — `addInitScript` called via concrete `PlaywrightAdapter` cast in both workers (bypasses interface), `outputFile` accessed via downcast to `Extractor` in orchestrator and `DebugStepRunner`.

## Design

### Security

**SEC-H2 — outputFile path traversal:** `writeOutputRow` in `ParserOrchestrator` now checks `filePath.startsWith(this.outputDir + '/')` after `resolve()` and returns early on violation. Complements the existing `entryUrl` scheme check.

**SEC-H1 — WebhookService SSRF:** `WebhookService.fire()` calls a new `validatePrivateAddress(hostname)` helper that DNS-resolves the hostname and rejects RFC-1918, loopback, and link-local addresses before `fetch()`.

**SEC-H3 — parser name path traversal:** Two validation guards in `parsers.ts` (create and import handlers) reject names not matching `/^[a-zA-Z0-9 _-]{1,100}$/`. Names are used as filesystem directory components via `resolve(outputBaseDir, config.name, runId)`.

**SEC-H4 — production error leakage:** The global error handler in `server.ts` returns `'Internal server error'` when `NODE_ENV === 'production'`; full `err.message` only in dev.

**SEC-H5 — status check before bcrypt:** `LoginUser` checks `record.status !== 'active'` before calling `comparePassword`, preventing timing-based oracle on deactivated accounts.

**SEC-L1 — worker memory limits:** All `new Worker(...)` calls (orchestrator and `DebugStepRunner`) pass `resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 128 }`.

**SEC-L2 — JWT enforcement:** `jwtService.ts` throws if `JWT_SECRET` is shorter than 32 characters. `jwt.verify` pins `algorithms: ['HS256']` to prevent algorithm-confusion attacks. `.env.example` documents the `openssl rand -hex 32` generation command.

**SEC-M1 — multi-tenant parser isolation:** `organization_id UUID` column added to `parsers` table (migration `0008_org_isolation.sql`). `ParserPersistenceService.create()` takes `organizationId`; new `getParserByNameAndOrg(name, orgId)` method scopes reads. `RunPersistenceService.listParsersWithLatestRun()` gains an `orgId` parameter and `AND p.organization_id = ${orgId}` in its raw SQL. Routes in `parsers.ts` refactored to `/:id` (UUID) with `router.param('id', ...)` enforcing org isolation centrally before every sub-route.

**SEC-M2 — RBAC on write routes:** `requireRole('admin')` applied to all mutating parser routes: create, delete, start, stop, resume, step create/update/delete, debug.

**SEC-M3 — XSS bridge removed:** `page.exposeFunction('logToNode', ...)` and the `window.debugLog` init script removed from both `ExtractorWorker` and `TraverserWorker`. These exposed a cross-page JS-to-Node channel executable by any script on the scraped page.

**SEC-M4 — Content-Disposition header injection:** Export route sanitises the parser name with `/[^a-zA-Z0-9 _-]/g → '_'`. File download route uses `filename*=UTF-8''${encodeURIComponent(file)}` (RFC 5987).

**SEC-M5 — ILIKE wildcard injection:** `RunPersistenceService.listParsersWithLatestRun` escapes `%`, `_`, and `\` in the search term before constructing the ILIKE pattern.

**SEC-M6 — pagination bounds:** `page` parameter capped at 10 000; `search` truncated to 200 characters at the route layer.

**SEC-M7 — security headers:** `app.use(helmet())` added before CORS middleware in `server.ts`. Rate limiting: `loginLimiter` (10/15 min) and `registerLimiter` (5/hr) via `express-rate-limit` applied to `/api/auth/login` and `/api/auth/register`.

**SEC-C2 — worker bootstrap path whitelist:** `worker-bootstrap.js` builds a `Set` of the two allowed absolute TS paths (`ExtractorWorker.ts`, `TraverserWorker.ts`) and throws on any other `__workerPath`.

### Concurrency

**CON-C1 — checkCompletion double-resolution:** `checkCompletion()` sets `this.completing = true` synchronously (before the async IIFE's first `await`); resets to `false` if `isComplete()` returns false. The `stopped` and `completing` guards now also check `this.pendingMessageHandlers > 0`.

**CON-C2/C3 — double-decrement:** Added `private activeTaskIds = new Set<string>()`. All `globalActive--` occurrences guarded by `if (this.activeTaskIds.delete(msg.taskId))`, ensuring each taskId decrements exactly once regardless of how many handlers receive its completion.

**CON-H1/H2 — quota bypass:** `globalActive++` and `activeTaskIds.add(taskId)` moved to the synchronous section of `dispatchTask()` and `flushDispatchQueue()`, before any `await`.

**CON-H3 — _sendToWorker race:** Checks `this.stopped` after both `getTask` and `markInProgress` awaits; decrements and deletes from `activeTaskIds` on every early-return path.

**CON-H4 — closeAllWriters race:** Snapshots `pendingWrites` before clearing (`const toFlush = [...this.pendingWrites]; this.pendingWrites = []`) so writes enqueued during the flush iteration aren't lost.

**CON-H5 — stop() vs checkCompletion() race:** `stop()` only calls `closeAllWriters()` if `!this.completing`.

**CON-H6 — retryTask TOCTOU:** Guarded by `private retryingTasks = new Set<string>()` — second concurrent call throws immediately.

**CON-M1 — TaskWriteBuffer error recovery:** `flush()` catch block re-inserts failed entries back into `this.tasks` / `this.results` (guarded to avoid overwriting a newer entry).

**CON-M2 — DbTaskStateStore mutate() serialization:** Added `private locks = new Map<string, Promise<unknown>>()`. Each `mutate(id, fn)` chains onto the previous promise for the same ID, serialising concurrent state transitions. The `finally` block releases and cleans up the map entry.

**CON-M3 — ParserRunnerService TOCTOU:** `run()`, `resume()`, and `retryFailed()` set a sentinel `this.activeRuns.set(parserName, null)` synchronously before their first `await`, preventing concurrent starts for the same parser name.

**CON-M4 — premature completion:** Added `private pendingMessageHandlers = 0`. The `worker.on('message', ...)` listener increments before dispatching and calls `checkCompletion()` in `.finally()` after each handler settles. `checkCompletion()` returns early while `pendingMessageHandlers > 0`.

### Worker protocol

**WRK-H1 — PAGE_FAILED early-exit missing checkCompletion:** The early-return branch (already-terminal task) now calls `this.checkCompletion()`.

**WRK-L1 — taskHtml leak:** Same early-return branch now calls `this.taskHtml.delete(msg.taskId)`.

**WRK-L2 — WorkerData type gap:** `__workerPath?: string` added to both branches of the `WorkerData` union in `messages.ts`.

**WRK-L3 — silent PROCESS_PAGE drop on shutdown:** Both workers now send `{ type: 'PAGE_FAILED', taskId: msg.task.id, error: 'Worker is shutting down' }` when `running === false` instead of silently ignoring the message.

**WRK-M1/M2 — exhaustiveness:** `default: never` case added to `handleWorkerMessage` in `ParserOrchestrator` and to the worker message switch in `DebugStepRunner`.

### DDD layering

**DDD-H8 — addInitScript on interface:** `addInitScript(script: string): Promise<void>` added to the `BrowserAdapter<P>` interface. `PuppeteerAdapter` gets a no-op implementation. Both workers drop their concrete `as PlaywrightAdapter` casts and call through the interface.

**DDD-H9 — Step.outputFile on base class:** `readonly outputFile?: string` added to the `Step` base class. `ParserOrchestrator` and `DebugStepRunner` drop their `as Extractor` downcasts.

## Questions and Answers

- **Q1 — Why not full OS-level sandbox for SEC-C1 (user code execution)?** Requires Docker/seccomp infrastructure changes outside the scope of this audit. Partial mitigation shipped: `resourceLimits` on every Worker constructor, `__workerPath` whitelist in bootstrap, `logToNode` XSS bridge removed. Documented as a known limitation.
- **Q2 — Why use `router.param('id', ...)` for SEC-M1 instead of per-route lookups?** Centralises the org isolation check in one place; routes use `res.locals.parser` and trust the param middleware has already validated org membership. Fewer places to forget the check.
- **Q3 — Why allow spaces in parser names?** Parser names are directory components on the filesystem — spaces are valid on all supported platforms. The path traversal check (`startsWith(outputDir + '/')`) catches the dangerous patterns; spaces alone are not dangerous.
- **Q4 — CON-L1 (RunPersistenceService final flush timing)?** Analysed as already addressed: `markRunCompleted` and `markRunStopped` both call `flushPendingWrites()` at entry, and `allTasks()` also flushes before loading. No additional change needed.

## Trade-offs

| Decision | Trade-off |
|---|---|
| `activeTaskIds` Set for double-decrement guard | Small per-run memory overhead; negligible for any realistic task count. |
| Per-task promise-chain lock in `mutate()` | Serialises mutations per task — slightly reduces parallelism, but mutations for different tasks still run concurrently. |
| `pendingMessageHandlers` counter | `checkCompletion()` is now called one extra time per message from the `finally` handler; the `completing` guard makes this a very cheap no-op in the common case. |
| SEC-C1 partial mitigation only | Full sandboxing is the correct fix but requires infrastructure investment (Docker, seccomp, or a V8 isolate). `resourceLimits` + path whitelist reduces blast radius without blocking the audit work. |
| Routes use `/:id` (UUID) instead of `/:name` | Breaking API change; frontend was already passing UUIDs so no client change needed. Enables the `router.param` org-isolation pattern cleanly. |

## Implementation Results

All 54 of 56 findings shipped across 12 commits on `fix/audit-findings`:

- Security: SEC-H1–H5, SEC-L1–L2, SEC-M1–M7, SEC-C2 — all implemented.
- Concurrency: CON-C1–C3, CON-H1–H6, CON-M1–M4 — all implemented. CON-L1 confirmed already addressed.
- Worker protocol: WRK-H1, WRK-L1–L3, WRK-M1–M2 — all implemented.
- DDD: DDD-H8–H9 — implemented.
- SEC-C1 (unsandboxed AsyncFunction): partial mitigation only; full sandbox deferred.
- New files: `src/infrastructure/webhook/WebhookService.ts` (SSRF-guarded), `src/api/utils/validateUrl.ts` (DNS SSRF validator), `src/infrastructure/db/migrations/0008_org_isolation.sql`.
- `/api/auth/me` bug fixed: `authenticate` middleware added directly to the route so cookie is verified on page reload.
