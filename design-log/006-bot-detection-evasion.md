# 006 — Bot detection evasion: delays and context rotation

## Background

A Playwright Stealth extractor targeting boat24.com succeeded on the first two pages then failed on all subsequent ones. The error HTML showed a bot-detection wall. Concurrent Quota was set to 1, so throughput was not the issue. The cause was session-based fingerprinting: the site tracked the same browser context across requests and blocked it after a short burst.

Two contributing factors were identified:

1. **No delay between requests** — pages were opened back-to-back with zero think time, which is machine-like behaviour.
2. **External CDN request for jQuery** — the extractor injected jQuery via `page.addScriptTag({ url: '...' })`, triggering an outbound CDN request that sites use as a bot signal. Fix: use `{ path: './jquery-3.7.1.min.js' }` so the file is served from disk and no third-party domain is contacted.

The core structural problem is that a single browser context accumulates cookies, local storage, and network fingerprint across all pages of a run. Even with stealth patches, a long-lived context is distinguishable from a human session.

## Design

Four changes, each independently useful and composable:

### 1. Random delay between page requests

Added `pageDelayMin` and `pageDelayMax` (ms) to `StepSettings`. In `ExtractorWorker.processPage`, a `randomDelay(min, max)` call fires before `adapter.newPage()`. The random component prevents the request interval from being perfectly uniform, which is another detection signal.

```ts
function randomDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

Values are read from merged settings (parser-level `browserSettings` + step-level `stepSettings`) so they can be set globally or per-step.

### 2. Browser context rotation (`maxPagesPerContext`)

Added `maxPagesPerContext: number` to `StepSettings` (0 = disabled). After every N completed pages the worker closes the adapter and relaunches a fresh one — new browser process, new context, clean slate with no accumulated session state.

The rotation is managed in `drainQueue`, not in `processPage`, so it only triggers when no pages are actively in flight (`activeCount === 0`). This avoids rotating mid-batch, which could leave in-flight requests sharing a dying context:

```ts
function drainQueue(step) {
  if (rotating) return;                                           // paused during rotation
  if (maxPagesPerContext > 0
      && pagesProcessed >= maxPagesPerContext
      && activeCount === 0) {
    rotating = true;
    rotateAdapter()
      .then(() => { pagesProcessed = 0; rotating = false; drainQueue(step); })
      .catch(console.error);
    return;
  }
  // normal drain loop …
}
```

`rotateAdapter()` calls `adapter.close()`, recreates the adapter via `createBrowserAdapter(savedSettings)`, calls `adapter.launch()`, and re-registers any `initScripts` via `PlaywrightAdapter.addInitScript`.

`pagesProcessed` is incremented after each page completes. On failure, `pagesProcessed` is additionally clamped to `maxPagesPerContext`, which triggers rotation immediately after all in-flight pages finish (see §4).

### 3. Rotate on failure — immediate, unconditional

A failed page is a strong signal that the current context has been flagged. Two requirements emerged from testing:

1. **Unconditional** — rotation must fire on failure even when `maxPagesPerContext = 0` (quota rotation disabled). The first implementation gated on `maxPagesPerContext > 0`, so users who hadn't configured a quota never saw rotation.
2. **Immediate** — rotation must start as soon as the failing page's callback fires, not after all concurrent in-flight pages finish. With concurrency > 1, waiting for `activeCount === 0` delayed rotation by however long the sibling pages took.

These two requirements led to splitting `drainQueue` into two distinct rotation paths:

```ts
function drainQueue(step) {
  if (rotating) return;

  // Failure rotation: immediate — kills any in-flight pages
  if (needsRotation) {
    rotating = true;
    needsRotation = false;
    contextKilledCount = activeCount;   // see §3a
    rotateAdapter()
      .then(() => { pagesProcessed = 0; rotating = false; drainQueue(step); })
      .catch(console.error);
    return;
  }

  // Quota rotation: wait for in-flight pages to finish cleanly
  if (maxPagesPerContext > 0 && pagesProcessed >= maxPagesPerContext && activeCount === 0) {
    rotating = true;
    rotateAdapter()
      .then(() => { pagesProcessed = 0; rotating = false; drainQueue(step); })
      .catch(console.error);
    return;
  }

  // normal drain …
}
```

`needsRotation` is a boolean flag set to `true` on any page failure. It is independent of `maxPagesPerContext`.

Quota rotation retains the `activeCount === 0` guard because it is proactive, not reactive — there is no urgency, and letting in-flight pages complete cleanly avoids wasting their results.

`processPage` was changed from `Promise<void>` to `Promise<boolean>` (`true` = success, `false` = failure). The function never rejects (errors are caught internally), so `.then()` receives every outcome.

#### §3a — Preventing spurious second rotation from killed pages

When failure rotation fires with `activeCount > 0`, `adapter.close()` kills the browser context shared by all in-flight pages. Those pages throw, their `catch` blocks run, and their `.then(false)` callbacks are queued. Without extra bookkeeping, those callbacks would set `needsRotation = true` and trigger a second rotation on a brand-new context.

Fix: capture the number of in-flight pages at rotation start as `contextKilledCount`. In the page callback, failures from killed pages decrement the counter instead of setting `needsRotation`:

```ts
// page callback:
if (!success) {
  if (contextKilledCount > 0) contextKilledCount--;  // killed by us — ignore
  else needsRotation = true;                          // genuine bot-detection failure
}
```

`contextKilledCount` is set before `rotateAdapter()` is awaited, so it is in place regardless of whether the killed pages' callbacks fire during or after the rotation.

### 4. Apply to TraverserWorker

All of the above (delays, quota-based rotation, failure-triggered rotation) was also applied to `TraverserWorker`, which traverses pages to discover links. Traverser steps hit the same bot-detection walls as extractor steps and need the same protections.

### 5. UI surface

**`StepSettingsBar`** (step-level settings in the parser editor) gains two new dedicated number inputs alongside the existing Delay Min / Delay Max inputs:

- **Max Pages/Context** — integer, 0 = off

All three dedicated inputs are excluded from the JSON editor display and re-applied when the JSON editor saves, so they do not interfere with arbitrary `stepSettings` JSON.

A pre-existing bug was fixed here: the `save(patch)` helper only merged the JSON editor content with the patch, so updating Delay Min via its input would silently drop any previously saved Delay Max (because Delay Max was stripped from the JSON editor). Fixed by a `dedicated()` helper that reads all three dedicated values from `step.stepSettings` and spreads them as the base before applying JSON content and the patch:

```ts
function dedicated() {
  const { pageDelayMin, pageDelayMax, maxPagesPerContext } = step.stepSettings
  return {
    ...(pageDelayMin != null && { pageDelayMin }),
    ...(pageDelayMax != null && { pageDelayMax }),
    ...(maxPagesPerContext != null && { maxPagesPerContext }),
  }
}

function save(patch) {
  onSave({ ...dedicated(), ...JSON.parse(json || '{}'), ...patch })
}
```

**`ParserSettingsPanel`** — the browser settings schema modal (added in the same session as this feature) documents `pageDelayMin`, `pageDelayMax`, and `maxPagesPerContext` with descriptions.

## Questions and Answers

- **Q1 — Why does quota rotation wait for `activeCount === 0` but failure rotation does not?** Quota rotation is proactive — it fires on a healthy context at a scheduled threshold, so letting in-flight pages finish cleanly wastes nothing. Failure rotation is reactive — the context is already poisoned, so waiting for sibling pages to finish means retrying them on a context that will just fail them too.
- **Q2 — Should failed pages count toward `pagesProcessed`?** Yes. A failed page still made network requests and potentially left session fingerprints on the site. Counting it ensures the context is rotated on schedule regardless of success rate.
- **Q3 — What happens to in-flight pages when failure rotation fires?** `adapter.close()` kills the shared browser context. In-flight pages throw, their catch blocks run, and their `.then(false)` callbacks decrement `contextKilledCount` instead of setting `needsRotation`. This prevents a spurious second rotation on the brand-new context.
- **Q4 — Why not rotate per extractor step rather than per worker?** Each worker owns one step and one adapter lifecycle. Rotation within the worker is the right granularity — no cross-worker coordination needed.
- **Q5 — Why a `needsRotation` flag rather than directly calling `rotateAdapter()` in the page callback?** The callback runs in the microtask queue where `rotating` may already be `true`. Calling `rotateAdapter()` directly could start a second concurrent rotation. The flag defers the decision to `drainQueue`, which checks `rotating` first.
- **Q6 — Why use `.then()` instead of `.finally()` after changing `processPage` to return `boolean`?** `.finally()` does not receive the resolved value, so the success/failure signal would be lost. Since `processPage` never rejects (errors are caught internally), `.then()` is called on every completion and is equivalent to `.finally()` for the `activeCount--` and `drainQueue()` side-effects.
- **Q7 — Why was failure rotation originally gated on `maxPagesPerContext > 0`?** The first implementation reused the quota counter (`pagesProcessed = maxPagesPerContext`) to trigger rotation, which required the quota to be enabled. When users didn't set `maxPagesPerContext`, rotation never fired on failure. The fix was a separate `needsRotation` boolean with no dependency on the quota setting.

## Trade-offs

- **Rotation adds latency**: each rotation takes the time of a browser cold start (typically 1–3 s). For `maxPagesPerContext = 10`, this adds ~10–30 % overhead at 3 s/rotation with a 1 s/page average. Acceptable for stealth; tunable by raising the threshold.
- **Failure rotation kills in-flight pages**: with concurrency > 1, siblings of a failing page are aborted and retried on the new context. This is intentional — siblings are likely to fail anyway on a poisoned context — but it does increase the retry count for those tasks.
- **`rotating` flag vs. queue pause**: an alternative is to drain the queue into a holding buffer during rotation. The flag approach is simpler and sufficient because the queue itself acts as the buffer — tasks stay in `queue[]` until `drainQueue` is called again.
- **`contextKilledCount` assumes all in-flight failures are from context closure**: if a sibling page fails for a genuine reason (e.g. network timeout independent of bot detection) at the same moment rotation starts, its failure is attributed to context kill and `needsRotation` is not set for it. This is acceptable — the rotation was already triggered by the original failure, so the outcome is the same.

## Implementation Results

Files changed:

- `src/domain/value-objects/StepSettings.ts` — added `pageDelayMin`, `pageDelayMax`, `maxPagesPerContext`
- `src/infrastructure/worker/ExtractorWorker.ts` — `randomDelay`, `rotateAdapter`, rotation state variables (`pagesProcessed`, `rotating`, `needsRotation`, `contextKilledCount`), split `drainQueue` (failure path: immediate, quota path: waits for `activeCount === 0`), `processPage` returns `boolean`, `main()` wires new settings
- `src/infrastructure/worker/TraverserWorker.ts` — identical rotation and delay implementation as ExtractorWorker
- `client/src/components/ParserEditorPage.tsx` — `StepSettingsBar` gains Max Pages/Context input; `dedicated()` helper fixes the silent-drop bug for all dedicated inputs
- `client/src/components/ParserSettingsPanel.tsx` — schema modal documents `maxPagesPerContext`, `pageDelayMin`, `pageDelayMax`
