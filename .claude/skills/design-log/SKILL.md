---
name: design-log
description: Create a new numbered design-log entry and register it in the index. Use after any architectural change — new entities/value objects/services, worker-protocol or lifecycle changes, new persistence patterns, new API contracts, new React component patterns, or new runtime settings — as mandated by CLAUDE.md.
---

Record an architectural decision in `design-log/`. This enforces the standing rule in CLAUDE.md: every architectural change gets a log entry.

## Steps

1. **Find the next number.** List `design-log/` and take the highest `NNN-*.md` + 1. Zero-pad to three digits (e.g. `007`).

2. **Read a recent entry** in `design-log/` to match its exact section structure and tone before writing. Do not invent a new format.

3. **Create `design-log/NNN-short-slug.md`** with these sections (same as existing entries):
   - **Background** — what existed before, the context the reader needs.
   - **Problem** — what forced the change.
   - **Design** — the decision and how it works. Reference concrete files/symbols.
   - **Questions and Answers** — open questions raised during design and how they were resolved.
   - **Trade-offs** — what was given up, alternatives rejected and why.
   - **Implementation Results** — what actually shipped. (For later bug fixes that don't change the design, append here instead of creating a new log.)

4. **Append a row to `design-log/index.md`** matching the existing table columns: log number, title linked to the file, status, and a one-line description.

## When NOT to create a new entry
- Bug fixes that don't change the design → append to the **Implementation Results** of the relevant existing log.
- Cosmetic/style-only changes, or renames without behaviour change → no entry.

## What counts as architectural (from CLAUDE.md)
Adding/removing domain entities, value objects, or services; changes to the worker message protocol or worker lifecycle; new persistence patterns (tables, query patterns, services); new or changed API endpoints; new React component patterns or cross-cutting UI concerns; new settings/config fields affecting runtime behaviour.

## Checklist
- [ ] Next number computed from existing files (no gaps, no collisions)
- [ ] New entry follows the existing section format exactly
- [ ] All sections filled with specifics (real file paths/symbols, not placeholders)
- [ ] Row appended to `design-log/index.md` with correct status and link
