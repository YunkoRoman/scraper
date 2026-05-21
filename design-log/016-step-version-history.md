# 016 — Step code version history

## Background

Step code evolves incrementally as users refine selectors, fix bugs, and tune extraction logic. Prior to this change, saving a new code version silently overwrote the previous one. If a "working" version was replaced by a broken one, the user had no way to recover the earlier code short of digging through git history (which most users don't have access to for the DB-stored code).

## Problem

Every `PUT` to a step's code field was destructive. There was no rollback path and no audit trail for code changes. Debugging regressions required users to recall what they had changed rather than inspecting a diff or restoring a previous state.

## Design

**DB — `stepVersions` table** (migration `0006_step_versions.sql`):

```
id (uuid PK), stepId (FK → steps), code (text)
savedAt (timestamptz, default now())
```

Append-only; no updates or overwrites after creation.

**`StepVersionPersistenceService`** (`src/infrastructure/db/StepVersionPersistenceService.ts`):

- Extends `BasePersistenceService`; `update()` throws `Error('Version records are immutable')` to enforce append-only semantics.
- `save(stepId, code)` — inserts a new row; called automatically on step code change.
- `list(stepId, limit = 20)` — returns versions ordered by `savedAt DESC`; capped at 20 to bound UI list size.

**Snapshot trigger in `ParserPersistenceService.updateStep`:**

- Before applying the code update, reads the existing step row.
- If the new code differs from the stored code and the existing code is non-empty (prevents snapshotting the first save from a blank step), calls `versions.save(stepId, existingCode)`.
- The `versions` service reference is optional (`null` if not injected); `updateStep` proceeds normally without snapshotting if it is absent.
- Snapshot errors are caught and logged rather than propagated — a failed version save should not block the primary step update.

**`server.ts`** — `StepVersionPersistenceService` instantiated and passed to `parserService.setVersionService(stepVersionService)` before the server starts. Also injected into the parsers router for the list/restore routes.

**API routes:**

| Method | Path | Action |
|---|---|---|
| GET | `/api/parsers/:id/steps/:stepName/versions` | List up to 20 recent versions |
| POST | `/api/parsers/:id/steps/:stepName/versions/:versionId/restore` | Restore a version (writes it as the current code, saving the current as a new snapshot) |

**`StepVersionsPanel`** — React component displayed alongside the code editor via a "History" toggle button:

- Fetches versions on open.
- Displays each version's `savedAt` timestamp and a truncated code preview.
- "Restore" calls the restore endpoint and re-fetches the step to update the editor.

**`ParserEditorPage.tsx`** — "History" button toggles `StepVersionsPanel` open/closed; panel is hidden while closed so it does not fetch versions unnecessarily.

## Questions and Answers

- **Q1 — Why save the *old* code on update rather than the *new* code?** The new code is already in the DB after the update. Version history should capture states the user might want to *return to*, which are the states that existed before the overwrite — i.e. the old code.
- **Q2 — Why cap the list at 20?** Unbounded lists can become large for actively developed steps. 20 versions covers months of daily iteration for most users while keeping the UI manageable.
- **Q3 — Why not snapshot on first save (empty → non-empty)?** Snapshotting an empty string produces a useless version entry. The guard `existing.code.trim().length > 0` ensures only meaningful code states are stored.
- **Q4 — Why is snapshot failure non-fatal?** The primary goal of `updateStep` is to save the new code. A secondary audit trail failure should not prevent the user's save from succeeding. The error is logged for debugging.
- **Q5 — Why is `restore` implemented as a new `updateStep` call rather than a DB-level swap?** Restoring via `updateStep` automatically snapshots the *current* code before overwriting it, giving the user an undo path after an accidental restore. A raw DB swap would silently destroy the current state.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Append-only `stepVersions` table | History is accurate but unbounded in theory. A retention policy (delete versions older than N or beyond N rows per step) may be needed at scale. |
| 20-version cap on list | Older versions are not reachable through the UI even though they remain in the DB. A "load more" page would require pagination logic. |
| Snapshot on `updateStep` in persistence layer | Couples a side-effect (snapshotting) to a persistence method. Appropriate here because snapshotting is inseparable from the update operation, but it makes `updateStep` stateful. |
| Non-fatal snapshot errors | Means the DB may have code without a complete version trail under error conditions. Acceptable given the infrequency of DB write errors. |

## Implementation Results

- Migration `0006_step_versions.sql` applied; `stepVersions` table created with FK to `steps`.
- `StepVersionPersistenceService` implemented with immutable `update()` guard; unit tests verify `list()` ordering and immutability.
- Snapshot logic in `ParserPersistenceService.updateStep` confirmed to fire only when code changes and existing code is non-empty.
- `StepVersionPersistenceService` injected via `setVersionService`; router receives it via the deps object.
- Versions GET and restore POST routes wired into the parsers router.
- `StepVersionsPanel` component implemented; "History" toggle button in `ParserEditorPage` shows/hides the panel.
- Restore endpoint verified to snapshot current code before applying the restored code.
