# 015 — Proxy rotation pool

## Background

Workers already rotated browser contexts on failure (log 006) to defeat session-based bot detection. However, all contexts used the same network path. Sites performing IP-based blocking could identify and ban the scraping IP regardless of context rotation. Users needed a way to supply a list of proxy URLs and have the scraper rotate through them automatically.

## Problem

The existing context rotation in both `ExtractorWorker` and `TraverserWorker` created new browser contexts without changing the proxy. Workers had no proxy injection mechanism; `buildContextOptions` assembled context options from settings but did not handle a dynamic proxy source.

## Design

**`ProxyPoolService`** (`src/infrastructure/proxy/ProxyPoolService.ts`):

- Accepts `string[]` of proxy URLs in the constructor; filters blanks and trims whitespace.
- `next()` returns the next proxy URL using a round-robin (`idx % pool.length`) pattern and increments the index.
- `size()` returns the pool size; a size of 0 means no proxy should be applied.
- Stateless beyond the counter — no health tracking, no exclusion of failed proxies.

**`StepSettings` value object** — extended with `proxyPool?: string[]`. Workers receive this field inside `stepSettings` from the orchestrator's message payload.

**`buildContextOptions`** — accepts an optional `proxyOverride?: string` and merges it into the context options as `proxy: { server: proxyOverride }`, overriding any static proxy in the step's `contextOptions`.

**Worker integration (`ExtractorWorker`, `TraverserWorker`):**

- On worker startup, if `stepSettings.proxyPool` is non-empty, a `ProxyPoolService` instance is created.
- On every context rotation (both scheduled rotation via `maxPagesPerContext` and failure-triggered rotation), `pool.next()` is called and the result is passed to `buildContextOptions` as `proxyOverride`.
- If the pool is empty or absent, `proxyOverride` is `undefined` and `buildContextOptions` omits the proxy field — existing behaviour is preserved.

**`ParserEditorPage.tsx`** — a textarea for the proxy pool (one URL per line) is added to the step settings UI. The array is serialised as a newline-separated string in the UI and stored as `string[]` in `stepSettings`.

## Questions and Answers

- **Q1 — Why round-robin rather than random selection?** Round-robin distributes load evenly and is deterministic — easier to reason about and test. Random selection could, in theory, repeatedly hit the same proxy for many consecutive contexts. For pools of 10+ proxies, the distribution difference is negligible.
- **Q2 — Why no proxy health tracking or removal of failing proxies?** Health tracking requires feedback from the worker about which proxy caused the failure (not currently surfaced) and a cross-context shared state mechanism (workers are isolated threads). YAGNI; ban detection and failover belong in a future log entry.
- **Q3 — Why store the pool in `stepSettings` rather than at the parser level?** Different steps may require different proxies (e.g. a traverser using residential proxies, an extractor using datacenter proxies). Per-step granularity is more flexible without complicating the parser-level settings object.
- **Q4 — Why `proxyOverride` in `buildContextOptions` rather than patching `contextOptions.proxy` directly in the worker?** `buildContextOptions` is the canonical point where all context options are assembled. Centralising proxy injection there prevents duplication across `ExtractorWorker` and `TraverserWorker` and keeps the workers thin.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Round-robin rotation | Pool index is per-worker, not shared across workers. Two workers running the same step will each start from index 0, potentially using the same proxies in parallel. |
| No health tracking | A permanently blocked proxy stays in rotation until manually removed by the user. |
| Pool stored in `stepSettings` JSONB | No DB schema change; validated at runtime. Large pools (hundreds of URLs) increase the settings column size. |
| Per-context rotation only | Proxies rotate on context creation. A single context uses one proxy for all its pages — no per-page proxy change. |

## Implementation Results

- `ProxyPoolService` implemented and unit-tested (round-robin, empty pool, single-entry pool).
- `StepSettings` extended with `proxyPool?: string[]`.
- `buildContextOptions` updated to accept and apply `proxyOverride`.
- Both `ExtractorWorker` and `TraverserWorker` create a `ProxyPoolService` from `stepSettings.proxyPool` and call `next()` on every context rotation.
- Proxy pool textarea added to `ParserEditorPage` step settings UI.
- Build passes; manual test with a public SOCKS5 proxy confirmed context options contain the correct proxy server URL.
