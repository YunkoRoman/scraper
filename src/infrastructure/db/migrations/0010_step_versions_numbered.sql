ALTER TABLE step_versions ADD COLUMN IF NOT EXISTS version_number INT;
CREATE INDEX IF NOT EXISTS step_versions_step_num_idx ON step_versions(step_id, version_number DESC);
