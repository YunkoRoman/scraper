# Design Log Index

Catalog of design logs. Append entries here when a new log is created or its scope materially changes.

Status meanings:

- **drafted** — design written; open questions, scope or shape may still move.
- **locked** — design frozen; implementation can begin, no further design churn expected.
- **completed** — implemented and verified; log carries an Implementation Results section.

| #   | Title                                                                 | Status    | Description                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | [Starter: DDD scraper platform + Express API + React client](001-starter.md) | completed | Universal web scraping platform. DDD layering (domain/application/infrastructure/cli/api), one Worker Thread per step, Playwright as primary browser adapter, PostgreSQL + Drizzle ORM for persistence, Express REST + SSE API, React + Vite client. |
| 002 | [Failed page HTML capture](002-failed-page-html-capture.md) | completed | Capture the browser HTML at the moment a page job permanently fails and surface it in the Task Detail UI. Workers send HTML in PAGE_FAILED, orchestrator emits task_failed_html after final retry, persisted to taskResults as a sentinel row, shown in collapsible viewer. |
| 003 | [Monaco-based JSON editor](003-json-editor.md) | completed | Replace all JSON configuration textareas with a Monaco Editor in JSON mode. Syntax highlighting, inline error squiggles, and a Format button wired to Monaco's built-in document formatter. No new dependency — Monaco was already in the bundle for the step code editor. |
| 004 | [Browser type visibility and DbParserLoader fix](004-browser-type-visibility.md) | completed | Fix DbParserLoader silently dropping the browserType DB column (stealth adapter never activated). Surface browserType on RunInfo via a parsers leftJoin and display it in the Task Detail info grid. Reword the misleading "Not captured" HTML fallback message. |
| 005 | [JsonEditor stale closure fix](005-json-editor-stale-closure.md) | completed | Fix Monaco blur handler always reading stale empty state. onDidBlurEditorText registered the onBlur prop once at mount; subsequent renders created new closures over current state that were never registered. Fixed with an onBlurRef kept current via useEffect. |
| 006 | [Bot detection evasion: delays and context rotation](006-bot-detection-evasion.md) | completed | Defeat session-based bot detection (observed on boat24.com). Random inter-request delays (pageDelayMin/pageDelayMax). Context rotation every N pages (maxPagesPerContext). Failure rotation: immediate and unconditional — fires on any page failure without waiting for concurrent pages, kills siblings, contextKilledCount prevents spurious second rotation. Both workers. |
