-- 028_export_bundles: Adds manifest-first export bundle records for verified project part assets.
--
-- Bundles are generated from confirmed project part usages and include only verified
-- file-backed assets. The manifest column records both included assets and explicit omissions
-- so engineers can see exactly what is and is not in each bundle.

CREATE TABLE IF NOT EXISTS export_bundles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_label TEXT,
  bundle_format TEXT NOT NULL,
  storage_key TEXT,
  manifest JSONB NOT NULL DEFAULT '{}',
  part_count INTEGER NOT NULL DEFAULT 0,
  included_asset_count INTEGER NOT NULL DEFAULT 0,
  omitted_asset_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT export_bundles_format_check CHECK (bundle_format IN ('altium', 'solidworks', 'neutral'))
);

CREATE INDEX IF NOT EXISTS idx_export_bundles_project ON export_bundles(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_bundles_format ON export_bundles(bundle_format, created_at DESC);
