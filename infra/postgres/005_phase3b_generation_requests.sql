-- File header: Adds Phase 3B generation request tracking and source-readiness fields.

-- Datasheet revisions carry reviewed pin-table readiness without implying broad PDF parsing.
ALTER TABLE datasheet_revisions
  ADD COLUMN IF NOT EXISTS pin_table_status TEXT;

UPDATE datasheet_revisions
SET pin_table_status = 'not_available'
WHERE pin_table_status IS NULL;

ALTER TABLE datasheet_revisions
  ALTER COLUMN pin_table_status SET DEFAULT 'not_available',
  ALTER COLUMN pin_table_status SET NOT NULL;

ALTER TABLE datasheet_revisions DROP CONSTRAINT IF EXISTS datasheet_revisions_pin_table_status_check;
ALTER TABLE datasheet_revisions
  ADD CONSTRAINT datasheet_revisions_pin_table_status_check
  CHECK (pin_table_status IN ('not_available', 'available', 'needs_review'));

-- Existing workflow rows are remapped from earlier Phase 3A labels into the explicit Phase 3B state model.
ALTER TABLE generation_workflows DROP CONSTRAINT IF EXISTS generation_workflows_generation_status_check;
ALTER TABLE generation_workflows ALTER COLUMN source_datasheet_revision_id DROP NOT NULL;

UPDATE generation_workflows
SET generation_status = CASE generation_status
  WHEN 'ready' THEN 'available_to_request'
  WHEN 'blocked' THEN 'unavailable'
  WHEN 'in_progress' THEN 'processing'
  WHEN 'completed' THEN 'generated'
  ELSE generation_status
END;

ALTER TABLE generation_workflows
  ADD CONSTRAINT generation_workflows_generation_status_check
  CHECK (generation_status IN ('unavailable', 'available_to_request', 'requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed'));

-- Generation requests persist user intent and queue/review state without creating assets by implication.
CREATE TABLE IF NOT EXISTS generation_requests (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  target_asset_type TEXT NOT NULL CHECK (target_asset_type IN ('footprint', 'symbol', 'three_d_model')),
  source_datasheet_revision_id TEXT REFERENCES datasheet_revisions(id),
  source_asset_id TEXT REFERENCES assets(id),
  request_status TEXT NOT NULL CHECK (request_status IN ('requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL,
  requested_by TEXT NOT NULL,
  workflow_id TEXT REFERENCES generation_workflows(id),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_requests_part_id_target_asset_type ON generation_requests(part_id, target_asset_type, requested_at DESC);
