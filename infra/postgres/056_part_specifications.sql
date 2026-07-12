-- File header: Verbatim distributor specification rows per part and provider.
--
-- Provider adapters previously kept only six normalized numeric metrics and dropped the rest of
-- the distributor payload (DigiKey Parameters, Mouser ProductAttributes, JLC attributes, RoHS and
-- compliance fields). This table stores every provider label/value pair word for word so the part
-- detail page can show exactly what each distributor reports. Rows are a display snapshot: the
-- worker deletes and reinserts per (part_id, provider_id) on each import, so the table always
-- mirrors the latest provider response. The UNIQUE constraint is a backstop against duplicate
-- labels; adapters dedupe before persistence.

CREATE TABLE IF NOT EXISTS part_specifications (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  provider_id TEXT NOT NULL,
  source_record_id TEXT REFERENCES source_records(id),
  spec_key TEXT NOT NULL,
  spec_value TEXT NOT NULL,
  spec_group TEXT CHECK (spec_group IS NULL OR spec_group IN ('parametric', 'compliance', 'commercial', 'physical')),
  last_updated_at TIMESTAMPTZ NOT NULL,
  org_id TEXT REFERENCES organizations(id),
  UNIQUE (part_id, provider_id, spec_key)
);

CREATE INDEX IF NOT EXISTS part_specifications_part_id_idx ON part_specifications (part_id);
CREATE INDEX IF NOT EXISTS part_specifications_org_id_idx ON part_specifications (org_id);

-- Tenant isolation backstop, same contract as 055: API requests set app.current_org on their
-- request transaction; the worker, migrations, and operator scripts connect with app.rls_bypass=on.
ALTER TABLE part_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_specifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_specifications_tenant_isolation ON part_specifications;
CREATE POLICY part_specifications_tenant_isolation ON part_specifications
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));
