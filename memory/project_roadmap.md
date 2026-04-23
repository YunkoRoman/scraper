---
name: Project Roadmap
description: Future direction — parsers in DB, client-side parser editor
type: project
---

Parsers are currently TypeScript files under `src/parsers/`. Future plan: store parsers in a database and move the parser authoring UI to the client.

**Why:** Makes parsers dynamic (no redeploy needed), opens the door to multi-user/multi-tenant use.

**How to apply:** Design current features (debug runner, step metadata) to not depend on filesystem-only assumptions. `FileParserLoader` already has an interface abstraction in PLAN.md — keep that boundary clean so `DbParserLoader` can swap in later. Don't hardcode `src/parsers/` paths into client UI.
