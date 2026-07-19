-- File header: Queued per-MPN backfill requests that bulk-import missing BOM parts.
--
-- One row per deduplicated unmatched MPN (+ optional manufacturer) from a BOM import. The API
-- inserts queued rows; the worker daemon drains them: exact provider lookup, then a direct import
-- through the shared runProviderPartImport flow (when every exact candidate agrees on one part
-- identity), a parked needs_choice row with the candidates preserved for a human pick, or an honest
-- no_match. Backfill never approves, validates, or export-promotes anything -- imported parts
-- arrive exactly as unreviewed imports, same as the one-at-a-time flow.

CREATE TABLE IF NOT EXISTS bom_backfill_requests (
  id TEXT PRIMARY KEY,
  bom_import_id TEXT NOT NULL REFERENCES bom_imports(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  mpn TEXT NOT NULL,
  manufacturer_name TEXT,
  request_status TEXT NOT NULL DEFAULT 'queued' CHECK (
    request_status IN ('queued', 'searching', 'needs_choice', 'no_match', 'imported', 'failed')
  ),
  -- Exact provider candidates preserved verbatim when the outcome needs a human pick.
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  part_id TEXT REFERENCES parts(id),
  error_code TEXT,
  error_message TEXT,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id TEXT REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS bom_backfill_requests_import_idx ON bom_backfill_requests (bom_import_id);
-- Supports the worker's oldest-first queued claim.
CREATE INDEX IF NOT EXISTS bom_backfill_requests_claim_idx ON bom_backfill_requests (request_status, requested_at);
CREATE INDEX IF NOT EXISTS bom_backfill_requests_org_id_idx ON bom_backfill_requests (org_id);

-- Tenant isolation backstop, same contract as 055/056/057.
ALTER TABLE bom_backfill_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_backfill_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bom_backfill_requests_tenant_isolation ON bom_backfill_requests;
CREATE POLICY bom_backfill_requests_tenant_isolation ON bom_backfill_requests
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));
