---
name: add-api-endpoint
description: Scaffold a new Express API endpoint following this project's router-factory + use-case + persistence pattern, and keep the CLAUDE.md/AGENTS.md endpoint table in sync. Use when adding a route under src/api/routes/.
---

Add an HTTP endpoint the way this codebase already does it: a thin route in a `createXRouter(deps)` factory that delegates to an application use case or service — never business logic in the handler.

Endpoint to add: **{{method}} {{path}}** — {{purpose}}

## Pattern (how routes work here)

- Routers live in `src/api/routes/` (`parsers.ts`, `jobs.ts`, `dashboard.ts`). Each exports a `createXRouter(deps: Deps)` factory returning an `express.Router()`.
- Dependencies are injected via a `Deps` interface (services from `application/` and `infrastructure/db/`), wired in `src/api/server.ts`. Handlers call those services; they do not touch the DB or browser directly.
- SSE broadcasting goes through `../sse.js` (`broadcast`, `writeSSE`).

## Steps

1. **Pick the router.** Add the route to the existing router whose resource it belongs to (`parsers.ts` for `/api/parsers*`, `jobs.ts` for `/api/jobs*`). Create a new `routes/<resource>.ts` factory only for a genuinely new resource, and register it in `server.ts`.

2. **Keep the handler thin.** Parse/validate input, call a use case or service method, map the result to the HTTP response. If the route needs new behaviour, put that behaviour in:
   - a use case in `src/application/use-cases/` (one-shot orchestration), or
   - a method on the relevant `application/services/` or `infrastructure/db/*PersistenceService.ts`.
   Do **not** inline rules (retry/dedup/state transitions/settings merge) in the handler — that belongs in `application`/`domain`. (The ddd-boundary-reviewer agent will flag it.)

3. **Add dependencies through `Deps`.** If the handler needs a new service, add it to the router's `Deps` interface and construct/pass it from `server.ts`. Don't `new` services inside the handler.

4. **Persistence** (if needed). Add the query/method to the matching `*PersistenceService.ts`. New table/columns → update `src/infrastructure/db/schema.ts` and run `/create-migration`.

5. **Error handling.** Follow the existing convention (typed errors like `ParserAlreadyExistsError` → 4xx; unknown → 500). Match status codes used by sibling routes.

6. **Sync the docs.** Add the row to the endpoint table in **CLAUDE.md** (and `AGENTS.md` if it is a separate file, not a symlink): `| {{method}} | {{path}} | {{purpose}} |`.

7. **Design log.** A new endpoint is an API-contract change → run `/design-log` (CLAUDE.md mandates it).

## Checklist
- [ ] Route added to the correct `createXRouter` factory (or new factory registered in `server.ts`)
- [ ] Handler delegates to a use case/service — no business logic or direct DB/browser access
- [ ] New deps threaded through the `Deps` interface from `server.ts`
- [ ] Persistence method added; schema migrated via `/create-migration` if columns changed
- [ ] Error/status conventions match sibling routes
- [ ] Endpoint table in CLAUDE.md (and AGENTS.md) updated
- [ ] `/design-log` entry created
