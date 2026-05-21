DO $$ BEGIN
  ALTER TABLE scheduled_runs ADD CONSTRAINT scheduled_runs_parser_id_unique UNIQUE (parser_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
