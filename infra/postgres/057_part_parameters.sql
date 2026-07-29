-- File header: Typed, category-aware, reconciled part parameters derived from captured specs.
--
-- part_specifications (056) stores verbatim distributor label/value text per provider. This table is the
-- normalized projection over it: one reconciled row per (part_id, param_key), value parsed into a
-- canonical base unit, with per-source contributions preserved in the sources JSONB and a conflict flag
-- when sources disagree. It is a derived projection (like part_readiness_summaries), recomputed on each
-- import by the worker's persist pass -- not a normalized-object child -- so its id is derived from the
-- already-scoped part id and it is stamped by stampPartChildOrgIds, NOT namespaceNormalizedPartIds.
-- Datasheet extraction (a later phase) writes into the same table as another source with no schema change.

CREATE TABLE IF NOT EXISTS part_parameters (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  part_type TEXT NOT NULL,
  param_key TEXT NOT NULL,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('numeric', 'range', 'enum', 'boolean', 'text')),
  value_numeric NUMERIC,
  value_min NUMERIC,
  value_max NUMERIC,
  value_text TEXT,
  unit TEXT,
  is_conflicted BOOLEAN NOT NULL DEFAULT FALSE,
  confidence_score NUMERIC NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  winning_provider_id TEXT,
  winning_source_record_id TEXT REFERENCES source_records(id),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_updated_at TIMESTAMPTZ NOT NULL,
  org_id TEXT REFERENCES organizations(id),
  UNIQUE (part_id, param_key)
);

CREATE INDEX IF NOT EXISTS part_parameters_part_id_idx ON part_parameters (part_id);
CREATE INDEX IF NOT EXISTS part_parameters_org_id_idx ON part_parameters (org_id);
-- Supports parametric range search (a later phase); harmless to add now.
CREATE INDEX IF NOT EXISTS part_parameters_type_key_numeric_idx ON part_parameters (part_type, param_key, value_numeric);

-- Tenant isolation backstop, same contract as 055/056.
ALTER TABLE part_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_parameters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_parameters_tenant_isolation ON part_parameters;
CREATE POLICY part_parameters_tenant_isolation ON part_parameters
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));
