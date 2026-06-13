ALTER TABLE parsers
  ADD COLUMN organization_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE parsers
  ADD CONSTRAINT parsers_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES organizations (id)
  ON DELETE CASCADE;
