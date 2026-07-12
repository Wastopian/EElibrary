-- File header: Heuristic datasheet parameter extraction.
--
-- Adds the enrichment job type that reads a stored datasheet PDF and parses canonical parameters, plus
-- the per-source table that persists those extracted values. part_datasheet_parameters is a datasheet
-- SOURCE feeding the part_parameters reconciliation (migration 057) -- distinct from the reconciled
-- projection -- so a full re-import can re-include datasheet values. Extracted values are modest
-- confidence: they corroborate or flag conflicts with distributor values but do not override them.
-- Like the other derived/extracted catalog children, rows are stamped via stampPartChildOrgIds and
-- their id derives from the already-org-scoped part id, so this table is NOT namespaced separately.

-- Allow the new enrichment job type alongside datasheet_capture.
ALTER TABLE provider_enrichment_jobs DROP CONSTRAINT IF EXISTS provider_enrichment_jobs_type_check;
ALTER TABLE provider_enrichment_jobs
  ADD CONSTRAINT provider_enrichment_jobs_type_check
  CHECK (job_type IN ('datasheet_capture', 'datasheet_extraction'));

CREATE TABLE IF NOT EXISTS part_datasheet_parameters (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  param_key TEXT NOT NULL,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('numeric', 'range', 'enum', 'boolean', 'text')),
  value_numeric NUMERIC,
  value_min NUMERIC,
  value_max NUMERIC,
  value_text TEXT,
  unit TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  datasheet_revision_id TEXT REFERENCES datasheet_revisions(id),
  extracted_at TIMESTAMPTZ NOT NULL,
  org_id TEXT REFERENCES organizations(id),
  UNIQUE (part_id, param_key)
);

CREATE INDEX IF NOT EXISTS part_datasheet_parameters_part_id_idx ON part_datasheet_parameters (part_id);
CREATE INDEX IF NOT EXISTS part_datasheet_parameters_org_id_idx ON part_datasheet_parameters (org_id);

-- Tenant isolation backstop, same contract as 055/056/057.
ALTER TABLE part_datasheet_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_datasheet_parameters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_datasheet_parameters_tenant_isolation ON part_datasheet_parameters;
CREATE POLICY part_datasheet_parameters_tenant_isolation ON part_datasheet_parameters
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));
