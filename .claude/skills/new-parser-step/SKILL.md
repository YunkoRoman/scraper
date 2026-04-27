---
name: new-parser-step
description: Scaffold a new parser step type following the domain/application/infrastructure layer pattern
---

Create a new parser step type with name {{step_name}} and type {{step_type}} (traverser|extractor).

## Files to create or modify

1. **Worker** (`src/infrastructure/worker/{{StepName}}Worker.ts`)
   - Model after `TraverserWorker.ts` (traverser) or `ExtractorWorker.ts` (extractor)
   - Register any new message types in `src/infrastructure/worker/messages.ts`

2. **Domain** (only if a new domain concept is needed)
   - Add entity to `src/domain/entities/` following existing entity patterns
   - Add value objects to `src/domain/value-objects/` if needed

3. **Application wiring**
   - Register the new worker in `src/application/orchestrator/ParserOrchestrator.ts`
   - Update `src/application/services/ParserRunnerService.ts` if step type dispatch logic needs updating

4. **Schema** (only if new DB columns needed)
   - Add columns to `src/infrastructure/db/schema.ts`
   - Run `/create-migration` to create the SQL migration file

## Checklist
- [ ] Worker file created following existing patterns exactly
- [ ] Message types registered if new ones added
- [ ] Orchestrator wired up
- [ ] Unit test added in `tests/` mirroring the existing test structure
