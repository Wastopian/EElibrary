-- File header: Adds provider import freshness and diagnostics metadata without changing provider-neutral records.

-- Source records now distinguish raw source observation from successful canonical import.
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMPTZ;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS source_last_imported_at TIMESTAMPTZ;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS import_status TEXT;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS import_error_details TEXT;

-- Existing source records were successful imports when they were linked to a normalized part.
UPDATE source_records
SET source_last_seen_at = COALESCE(source_last_seen_at, fetched_at, last_updated_at, now())
WHERE source_last_seen_at IS NULL;

UPDATE source_records
SET source_last_imported_at = COALESCE(source_last_imported_at, normalized_at, fetched_at, last_updated_at)
WHERE source_last_imported_at IS NULL
  AND (normalized_at IS NOT NULL OR part_id IS NOT NULL);

UPDATE source_records
SET import_status = CASE
  WHEN normalized_at IS NOT NULL OR part_id IS NOT NULL THEN 'imported'
  ELSE 'failed'
END
WHERE import_status IS NULL;

UPDATE source_records
SET import_error_details = NULL
WHERE import_status = 'imported';

ALTER TABLE source_records
  ALTER COLUMN source_last_seen_at SET DEFAULT now(),
  ALTER COLUMN source_last_seen_at SET NOT NULL,
  ALTER COLUMN import_status SET DEFAULT 'imported',
  ALTER COLUMN import_status SET NOT NULL;

ALTER TABLE source_records DROP CONSTRAINT IF EXISTS source_records_import_status_check;
ALTER TABLE source_records
  ADD CONSTRAINT source_records_import_status_check
  CHECK (import_status IN ('imported', 'failed'));

-- Operational diagnostics need fast recent and failed import lookups.
CREATE INDEX IF NOT EXISTS idx_source_records_provider_part ON source_records(provider_id, provider_part_key);
CREATE INDEX IF NOT EXISTS idx_source_records_import_status ON source_records(import_status, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_records_last_imported_at ON source_records(source_last_imported_at DESC NULLS LAST);
