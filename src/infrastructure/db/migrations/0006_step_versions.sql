CREATE TABLE IF NOT EXISTS step_versions (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id   UUID        NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  code      TEXT        NOT NULL,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS step_versions_step_idx ON step_versions(step_id, saved_at DESC);
