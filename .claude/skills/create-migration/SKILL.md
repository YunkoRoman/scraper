---
name: create-migration
description: Create a new raw SQL migration file for this project's manual migration system
disable-model-invocation: true
---

## How migrations work in this project

Migrations are raw `.sql` files in `src/infrastructure/db/migrations/`. They are applied in order by `src/infrastructure/db/migrate.ts`, which has a hardcoded list of filenames. Adding a new migration requires two steps: write the SQL file AND add the filename to the array in `migrate.ts`.

## Steps

1. **Determine next migration number**
   - Check existing files in `src/infrastructure/db/migrations/`
   - Current highest: `0002_run_persistence.sql` → next is `0003`

2. **Create the SQL file** at `src/infrastructure/db/migrations/{{NUMBER}}_{{description}}.sql`
   - Write idempotent SQL (use `IF NOT EXISTS`, `IF EXISTS`, `ADD COLUMN IF NOT EXISTS`)
   - Match column names to the Drizzle schema in `src/infrastructure/db/schema.ts` (camelCase in schema → snake_case in SQL)

3. **Register in migrate.ts**
   - Add the new filename to the `migrations` array in `src/infrastructure/db/migrate.ts`

4. **Test**
   - Run `npm run db:migrate` and verify it applies cleanly
   - If it fails, the SQL file can be fixed and re-run since migrations are not tracked (no migration table)

## Warning
This project has NO migration tracking table — migrations are re-run on every `npm run db:migrate` call. All SQL must be idempotent or it will error on the second run.
