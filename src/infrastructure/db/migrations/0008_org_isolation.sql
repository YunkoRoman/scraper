ALTER TABLE parsers
  ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE parsers
  DROP CONSTRAINT IF EXISTS parsers_organization_id_fkey;

ALTER TABLE parsers
  ADD CONSTRAINT parsers_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES organizations (id)
  ON DELETE CASCADE;
