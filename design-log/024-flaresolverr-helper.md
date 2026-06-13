# 024 — FlareSolverr/Byparr integration and developer reference docs

**Status:** completed

## Background

Sites protected by Cloudflare managed challenges block normal Playwright/Puppeteer scraping even with stealth adapters and fingerprint hardening — the JS challenge requires a real browser session to pass. FlareSolverr and Byparr are open-source Docker containers that solve CF challenges using a real browser, exposing a simple HTTP API. Users needed a way to route individual page requests through a solver without committing the entire parser to a different browser type.

## Problem

No mechanism existed to call a local CF solver from step code. The only workarounds were switching `browser_type` to `playwright-stealth` (which helps but doesn't guarantee bypass) or using an external proxy service. Additionally, there was no developer reference in the UI — users had to read source code to discover available step context variables (`page`, `task`, `solveCF`), step types, and all configurable settings.

## Design

### `solveCF` helper

A new `const solveCF = async (url, options = {}) =>` snippet is prepended to every step's user code at runtime, before the `AsyncFunction` constructor call. `const` binding (not `function`) prevents `var` hoisting from shadowing the helper if the user writes a `var solveCF` declaration.

The snippet:
- Reads the resolved solver URL from a closed-over `__fsUrl` constant (embedded at snippet generation time).
- Throws a descriptive error with the Docker run command if `__fsUrl` is empty.
- Wraps `fetch()` in try/catch to produce a "cannot reach solver" error when the container is not running.
- Enforces a 10 MB response size guard before deserialising.
- Throws if `solution.status !== 'ok'`, surfacing the solver's error message.
- Returns the full `solution` object (`response`, `cookies`, `userAgent`, `screenshot?`).

The second argument forwards any FlareSolverr/Byparr `request.get` parameters (`session`, `maxTimeout`, `cookies`, `returnOnlyCookies`, `returnScreenshot`, `waitInSeconds`, `disableMedia`, `proxy`, `tabs_till_verify`) via `...options` spread, so users can pass only what they need.

### `FlareSolverrService` (`src/infrastructure/flaresolverr/FlareSolverrService.ts`)

Two exported functions:

- **`validateFlareSolverrUrl(url)`** — rejects non-http/https protocols (SSRF guard) and malformed URLs. Empty string is accepted (feature disabled).
- **`makeSolveCFSnippet(flareSolverrUrl)`** — calls `validateFlareSolverrUrl` then returns the full snippet string with the URL embedded as `JSON.stringify(url)`.

### URL resolution priority

Workers resolve the solver URL in this order (first non-empty wins):

1. `data.stepSettings.flareSolverrUrl` — step-level override
2. `data.browserSettings.flareSolverrUrl` — parser-level setting
3. `process.env.FLARESOLVERR_URL` — global env fallback
4. `''` — feature disabled; `solveCF()` throws if called

### Domain changes

**`StepSettings`** (`src/domain/value-objects/StepSettings.ts`) — added `flareSolverrUrl?: string`. Consistent with existing `proxySettings` in the domain value object; the domain carries configuration fields without performing I/O.

**`BrowserSettings` Pick** (`src/infrastructure/worker/messages.ts`) — `'flareSolverrUrl'` added to the Pick so the parser-level setting flows through `data.browserSettings` to workers.

### Worker integration

Both `ExtractorWorker` and `TraverserWorker` — in the DB-sourced code path (`else` branch after the `parserFilePath` check):

```ts
const solverUrl =
  ('stepSettings' in data ? data.stepSettings?.flareSolverrUrl : undefined) ??
  data.browserSettings?.flareSolverrUrl ??
  process.env.FLARESOLVERR_URL ??
  ''
const solveCFSnippet = makeSolveCFSnippet(solverUrl)
const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + data.stepCode)
```

The file-based code path (`parserFilePath`) is unchanged — it uses statically imported step modules that cannot use the injected helper.

### Parser Settings UI (`ParserSettingsModal`)

A dedicated **Cloudflare Solver URL** text input added between Proxy Pool and Browser Settings JSON:
- Initialised from `parser.browserSettings.flareSolverrUrl`.
- Stripped from the JSON editor's initial value (alongside `proxyPool`) to avoid duplication.
- Merged back into `browserSettings` on save as `flareSolverrUrl` when non-empty.
- Inline Docker commands shown below the input for both FlareSolverr and Byparr — no `.env` changes required; URL is saved per-parser.

### Developer reference page (`/docs`)

A full developer reference at `/docs` (protected by `ProtectedRoute`). Sticky sidebar with `IntersectionObserver`-driven active section tracking. Sections:

- **Step Context** — `page` (Playwright/Puppeteer), `task` (url, id, stepName, parent_data, attempts), `solveCF(url, options?)`
- **Step Types** — Traverser (return shape, deduplication) and Extractor (rows, multiple-row pattern)
- **Step Settings** — all `StepSettings` fields with types, defaults, descriptions
- **Browser Settings** — `browser_type` enum with per-option notes
- **Parser Settings** — `retryConfig.maxRetries`, `deduplication`, `concurrentQuota`, `flareSolverrUrl`, `browserSettings`
- **Cloudflare Bypass** — two-step setup (Docker → Solver URL field), full `solveCF` options table, `solution` object shape
- **Recipes** — 6 copy-ready code examples (paginated traverser, product extractor, CF detect-and-solve, cookie injection, session reuse, headless-off debug)

`DocsIcon` (open book SVG) added to the sidebar nav.

## Questions and Answers

- **Q1 — Why inject via code prepending rather than a third `AsyncFunction` argument?** Adding a third argument (`'solveCF'`) would require changing the `AsyncFunction` signature in both workers and passing the live function across the call site. Code prepending keeps the signature `(page, task)` stable and requires no domain entity changes.
- **Q2 — Why `const solveCF` not `async function solveCF`?** `function` declarations are hoisted as `var` in non-strict non-module contexts. If user code contained `var solveCF = ...`, it would silently shadow the injected function. `const` bindings are not hoisted; any redeclaration produces a `SyntaxError` before execution.
- **Q3 — Why is `flareSolverrUrl` in the domain `StepSettings` rather than only in infrastructure?** `proxySettings`, `initScripts`, and `userAgent` are already in `StepSettings` — all are configuration values the domain needs to carry without acting on them. `flareSolverrUrl` follows the same pattern.
- **Q4 — Why a dedicated UI field instead of leaving it in the Browser Settings JSON?** Discovery: users setting up CF bypass for the first time would not know to look in a raw JSON blob. A dedicated labeled field with Docker commands inline removes all setup friction and matches the pattern of the Proxy Pool textarea.
- **Q5 — Why no automatic CF detection?** Automatic detection on every page would add latency and solver load to pages that don't need it. The user calls `solveCF()` only when needed — typically after detecting a challenge element or status code in step code.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Code prepending for `solveCF` injection | Snippet added to every DB-sourced step regardless of whether it's used; negligible parsing overhead. |
| Empty `flareSolverrUrl` = feature disabled | No error at worker startup; error deferred until `solveCF()` is called. Intentional — most users never need it. |
| URL embedded in snippet at generation time | If `flareSolverrUrl` changes in parser settings, already-running workers use the old URL until restarted. |
| No automatic CF detection | User must write detection logic; avoids latency on non-CF pages. |
| `/docs` requires auth | Prevents unauthenticated access; acceptable since the docs describe the platform's internal API surface. |

## Implementation Results

- `FlareSolverrService.ts` created with `validateFlareSolverrUrl` and `makeSolveCFSnippet`.
- 11 unit tests in `tests/infrastructure/FlareSolverrService.test.ts` (URL validation, snippet shape, connection error).
- `StepSettings` extended with `flareSolverrUrl?: string`; `BrowserSettings` Pick updated in `messages.ts`.
- Both `ExtractorWorker` and `TraverserWorker` inject `solveCFSnippet` in the DB code path.
- `ParserSettingsModal` — dedicated Cloudflare Solver URL input with inline Docker commands; field stripped from JSON editor, merged on save.
- `DocsPage.tsx` created at `client/src/pages/DocsPage.tsx`; route `/docs` added to `App.tsx`; `DocsIcon` + nav entry added to `Layout.tsx`.
- Docs updated to reflect UI-first setup (no `.env` required); `flareSolverrUrl` documented in Parser Settings section.
- `.env.example` updated with commented `FLARESOLVERR_URL` entry for users who prefer the env fallback.
