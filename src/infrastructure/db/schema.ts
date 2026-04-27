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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const parsersRelations = relations(parsers, ({ many }) => ({
  steps: many(steps),
}))

export const stepsRelations = relations(steps, ({ one }) => ({
  parser: one(parsers, { fields: [steps.parserId], references: [parsers.id] }),
}))

export const parserRuns = pgTable('parser_runs', {
  id:         uuid('id').primaryKey(),
  parserName: text('parser_name').notNull(),
  status:     text('status').notNull().default('running'),
  startedAt:  timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  stoppedAt:  timestamp('stopped_at', { withTimezone: true }),
})

export const runTasks = pgTable('run_tasks', {
  id:           uuid('id').primaryKey(),
  runId:        uuid('run_id').notNull().references(() => parserRuns.id, { onDelete: 'cascade' }),
  url:          text('url').notNull(),
  stepName:     text('step_name').notNull(),
  stepType:     text('step_type').notNull(),
  state:        text('state').notNull(),
  attempts:     integer('attempts').notNull().default(0),
  maxAttempts:  integer('max_attempts').notNull(),
  error:        text('error'),
  parentTaskId: uuid('parent_task_id'),
  parent_data:  jsonb('parent_data'),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const taskResults = pgTable('task_results', {
  taskId: uuid('task_id').primaryKey().references(() => runTasks.id, { onDelete: 'cascade' }),
  rows:   jsonb('rows').notNull().default([]),
})
