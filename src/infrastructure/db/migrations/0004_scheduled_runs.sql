CREATE TABLE IF NOT EXISTS scheduled_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parser_id       UUID        NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  cron_expression TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scheduled_runs_parser_id_idx ON scheduled_runs(parser_id);
CREATE INDEX IF NOT EXISTS scheduled_runs_next_run_idx  ON scheduled_runs(next_run_at) WHERE enabled = true;
