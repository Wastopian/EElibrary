-- File header: Adds passive-capture draft state to part engineering memory.
--
-- The memory primitive only earns its keep if it actually fills up, and a small team will not
-- hand-curate it. So the system auto-drafts records from things engineers already do (approving
-- a substitution, shipping an export bundle). Those auto-drafts are SUGGESTIONS, not memory:
-- they enter as `draft_status = 'proposed'` and only become durable engineering truth when a
-- human clicks Confirm. Dismiss preserves the row (audited, never deleted).
--
-- Honesty contract (unchanged): proposed rows never approve the part, validate assets, unlock
-- export, or count toward any gate. `draft_source` / `trigger_ref` are advisory provenance only.
-- Manual rows created before this migration default to 'confirmed'/'manual' so existing behavior
-- and the existing open/resolved split are preserved exactly.

ALTER TABLE part_engineering_records
  ADD COLUMN IF NOT EXISTS draft_status TEXT NOT NULL DEFAULT 'confirmed';

ALTER TABLE part_engineering_records
  ADD COLUMN IF NOT EXISTS draft_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE part_engineering_records
  ADD COLUMN IF NOT EXISTS trigger_ref TEXT;

ALTER TABLE part_engineering_records
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT;

ALTER TABLE part_engineering_records
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'part_engineering_records_draft_status_check'
  ) THEN
    ALTER TABLE part_engineering_records
      ADD CONSTRAINT part_engineering_records_draft_status_check
      CHECK (draft_status IN ('proposed', 'confirmed', 'dismissed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'part_engineering_records_draft_source_check'
  ) THEN
    ALTER TABLE part_engineering_records
      ADD CONSTRAINT part_engineering_records_draft_source_check
      CHECK (draft_source IN ('manual', 'auto_substitution', 'auto_export', 'auto_bom_lifecycle'));
  END IF;
END $$;

-- Powers the "Suggested from your activity — review" bucket without scanning resolved history.
CREATE INDEX IF NOT EXISTS idx_part_engineering_records_proposed
  ON part_engineering_records(part_id, recorded_at DESC)
  WHERE draft_status = 'proposed';
