-- File header: Adds Phase 5D validation evidence and export-promotion audit records.

-- Asset validation records store durable evidence that a reviewer or validation job can cite later.
CREATE TABLE IF NOT EXISTS asset_validation_records (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('verified', 'needs_review', 'not_validated', 'failed')),
  validation_type TEXT NOT NULL CHECK (validation_type IN ('file_integrity', 'footprint_geometry', 'symbol_pin_mapping', 'three_d_geometry', 'manual_engineering_review')),
  validation_notes TEXT,
  validated_at TIMESTAMPTZ NOT NULL,
  validator TEXT NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detail reads and promotion checks need fast asset-scoped lookup of the latest evidence.
CREATE INDEX IF NOT EXISTS idx_asset_validation_records_part_id ON asset_validation_records(part_id, validated_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_validation_records_asset_id ON asset_validation_records(asset_id, validated_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_validation_records_type ON asset_validation_records(asset_id, validation_type, validation_status);

-- Promotion audits record both successful and denied export-verification attempts.
CREATE TABLE IF NOT EXISTS asset_promotion_audits (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  prior_export_status TEXT NOT NULL CHECK (prior_export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')),
  new_export_status TEXT NOT NULL CHECK (new_export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')),
  promotion_outcome TEXT NOT NULL CHECK (promotion_outcome IN ('promoted', 'denied')),
  blocker_reasons TEXT[] NOT NULL DEFAULT '{}',
  validation_record_id TEXT REFERENCES asset_validation_records(id),
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detail reads show the latest promotion history beside the asset that was evaluated.
CREATE INDEX IF NOT EXISTS idx_asset_promotion_audits_part_id ON asset_promotion_audits(part_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_promotion_audits_asset_id ON asset_promotion_audits(asset_id, created_at DESC);
