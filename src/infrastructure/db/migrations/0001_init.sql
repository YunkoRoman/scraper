-- src/infrastructure/db/migrations/0001_init.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS parsers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  entry_url TEXT NOT NULL DEFAULT '',
  entry_step TEXT NOT NULL DEFAULT '',
  browser_type TEXT NOT NULL DEFAULT 'playwright',
  browser_settings JSONB NOT NULL DEFAULT '{}',
  retry_config JSONB NOT NULL DEFAULT '{"maxRetries":5}',
  deduplication BOOLEAN NOT NULL DEFAULT true,
  concurrent_quota INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parser_id UUID NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  entry_url TEXT NOT NULL DEFAULT '',
  output_file TEXT,
  code TEXT NOT NULL DEFAULT '',
  step_settings JSONB NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parser_id, name)
);
