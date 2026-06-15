-- Parser helper files: flat, per-parser, DB-stored TypeScript modules.
CREATE TABLE IF NOT EXISTS parser_files (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parser_id  UUID        NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  path       TEXT        NOT NULL,
  content    TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parser_id, path)
);
CREATE INDEX IF NOT EXISTS parser_files_parser_idx ON parser_files(parser_id);
