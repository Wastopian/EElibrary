-- 062_export_bundle_assembly_claim: Claim pending export-bundle assembly before copying bytes.
--
-- Pending rows were selected without claiming, so overlapping daemon ticks / CLI runs could
-- assemble the same bundle concurrently against the deterministic bundle.tar.gz path. Terminal
-- UPDATEs were unconditional on id, so a later failure could overwrite an earlier success (or
-- the reverse) while a partial writeFile left a corrupt archive that the UI still offered when
-- archiveAvailability gated on file existence alone.
--
-- This migration adds an in-flight `assembling` status plus `assembly_started_at` so the worker
-- can claim with SKIP LOCKED, finish with conditional UPDATEs, and reclaim abandoned claims.

ALTER TABLE export_bundles
  ADD COLUMN IF NOT EXISTS assembly_started_at TIMESTAMPTZ;

ALTER TABLE export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_assembly_status_check;

ALTER TABLE export_bundles
  ADD CONSTRAINT export_bundles_assembly_status_check
  CHECK (assembly_status IN ('not_required', 'pending', 'assembling', 'assembled', 'assembly_failed'));

DROP INDEX IF EXISTS idx_export_bundles_assembly_pending;

CREATE INDEX IF NOT EXISTS idx_export_bundles_assembly_pending
  ON export_bundles(created_at)
  WHERE assembly_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_export_bundles_assembly_assembling
  ON export_bundles(assembly_started_at)
  WHERE assembly_status = 'assembling';
