-- 031_export_bundle_assembly: Adds worker-side asset-byte assembly state and failure telemetry.
--
-- The synchronous manifest archive write (handled by the API in 028) is preserved as the audit
-- record of what should be in the bundle. Asset-byte assembly is moved to the worker so each
-- included asset's verified bytes can be copied into a deterministic per-bundle storage path
-- without blocking the API request. This migration adds the state machine and structured
-- failure telemetry so operators see exactly which asset failed and why instead of a generic
-- manifest warning string.

ALTER TABLE export_bundles
  ADD COLUMN IF NOT EXISTS assembly_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS assembly_error JSONB,
  ADD COLUMN IF NOT EXISTS assembly_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assembly_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_assembly_status_check;

ALTER TABLE export_bundles
  ADD CONSTRAINT export_bundles_assembly_status_check
  CHECK (assembly_status IN ('not_required', 'pending', 'assembled', 'assembly_failed'));

CREATE INDEX IF NOT EXISTS idx_export_bundles_assembly_pending
  ON export_bundles(created_at)
  WHERE assembly_status = 'pending';
