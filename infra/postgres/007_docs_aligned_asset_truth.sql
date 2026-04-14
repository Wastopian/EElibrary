-- File header: Aligns asset truth columns with docs/DATA_MODEL.md availability, review, and export statuses.

-- Canonical asset truth columns split storage availability, review, and export readiness.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS availability_status TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS review_status TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS export_status TEXT;

-- Availability is the docs-aligned name for the legacy asset_state storage lifecycle.
UPDATE assets
SET availability_status = COALESCE(availability_status, asset_state, 'missing')
WHERE availability_status IS NULL;

-- Review status is conservative: older rows without explicit review remain review-required or not-reviewed.
UPDATE assets
SET review_status = CASE
  WHEN review_status IS NOT NULL THEN review_status
  WHEN asset_status = 'failed' OR validation_status = 'failed' THEN 'rejected'
  WHEN asset_status IN ('reviewed', 'verified_for_export') THEN 'approved'
  WHEN provenance = 'generated' OR asset_status IN ('downloaded', 'validated') OR validation_status = 'needs_review' THEN 'review_required'
  ELSE 'not_reviewed'
END
WHERE review_status IS NULL;

-- Export status is earned from verified file-backed evidence, not references or review alone.
UPDATE assets
SET export_status = CASE
  WHEN export_status IS NOT NULL THEN export_status
  WHEN asset_state = 'validated' AND asset_status = 'verified_for_export' AND storage_key IS NOT NULL AND file_hash IS NOT NULL AND validation_status = 'verified' THEN 'verified_for_export'
  WHEN asset_state IN ('downloaded', 'validated') AND storage_key IS NOT NULL AND file_hash IS NOT NULL AND validation_status <> 'failed' THEN 'partially_exportable'
  ELSE 'not_exportable'
END
WHERE export_status IS NULL;

ALTER TABLE assets
  ALTER COLUMN availability_status SET DEFAULT 'missing',
  ALTER COLUMN availability_status SET NOT NULL,
  ALTER COLUMN review_status SET DEFAULT 'not_reviewed',
  ALTER COLUMN review_status SET NOT NULL,
  ALTER COLUMN export_status SET DEFAULT 'not_exportable',
  ALTER COLUMN export_status SET NOT NULL;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_availability_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_availability_status_check CHECK (availability_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed'));

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_review_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_review_status_check CHECK (review_status IN ('not_reviewed', 'review_required', 'approved', 'rejected', 'changes_requested'));

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_export_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_export_status_check CHECK (export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export'));
