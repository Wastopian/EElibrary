-- File header: Adds Phase 4A asset and generation-workflow review records.

-- Review records preserve explicit reviewer decisions without auto-verifying exports.
CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('asset', 'generation_workflow')),
  asset_id TEXT REFERENCES assets(id),
  generation_workflow_id TEXT REFERENCES generation_workflows(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected', 'changes_requested')),
  reviewer TEXT NOT NULL,
  notes TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (target_type = 'asset' AND asset_id IS NOT NULL AND generation_workflow_id IS NULL)
    OR (target_type = 'generation_workflow' AND generation_workflow_id IS NOT NULL AND asset_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_review_records_part_id ON review_records(part_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_records_asset_id ON review_records(asset_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_records_generation_workflow_id ON review_records(generation_workflow_id, reviewed_at DESC);
