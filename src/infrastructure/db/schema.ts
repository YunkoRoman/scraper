// src/infrastructure/db/schema.ts
import { pgTable, uuid, text, boolean, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const parsers = pgTable('parsers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  entryUrl: text('entry_url').notNull().default(''),
  entryStep: text('entry_step').notNull().default(''),
  browserType: text('browser_type').notNull().default('playwright'),
  browserSettings: jsonb('browser_settings').notNull().default({}),
  retryConfig: jsonb('retry_config').notNull().default({ maxRetries: 5 }),
  deduplication: boolean('deduplication').notNull().default(true),
  concurrentQuota: integer('concurrent_quota'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const steps = pgTable('steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  parserId: uuid('parser_id').notNull().references(() => parsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'traverser' | 'extractor'
  entryUrl: text('entry_url').notNull().default(''),
  outputFile: text('output_file'),
  code: text('code').notNull().default(''),
  stepSettings: jsonb('step_settings').notNull().default({}),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const parsersRelations = relations(parsers, ({ many }) => ({
  steps: many(steps),
}))

export const stepsRelations = relations(steps, ({ one }) => ({
  parser: one(parsers, { fields: [steps.parserId], references: [parsers.id] }),
}))
