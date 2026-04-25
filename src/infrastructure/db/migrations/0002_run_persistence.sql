CREATE TABLE IF NOT EXISTS parser_runs (
  id          UUID        PRIMARY KEY,
  parser_name TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'running',  -- 'running'|'stopped'|'completed'
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS parser_runs_parser_name_idx ON parser_runs(parser_name);
CREATE INDEX IF NOT EXISTS parser_runs_started_at_idx  ON parser_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS run_tasks (
  id             UUID        PRIMARY KEY,
  run_id         UUID        NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
  url            TEXT        NOT NULL,
  step_name      TEXT        NOT NULL,
  step_type      TEXT        NOT NULL,
  state          TEXT        NOT NULL,
  attempts       INTEGER     NOT NULL DEFAULT 0,
  max_attempts   INTEGER     NOT NULL,
  error          TEXT,
  parent_task_id UUID,
  parent_data    JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS run_tasks_run_id_idx        ON run_tasks(run_id);
CREATE INDEX IF NOT EXISTS run_tasks_run_id_state_idx  ON run_tasks(run_id, state);

CREATE TABLE IF NOT EXISTS task_results (
  task_id UUID  PRIMARY KEY REFERENCES run_tasks(id) ON DELETE CASCADE,
  rows    JSONB NOT NULL DEFAULT '[]'
);
