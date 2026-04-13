-- File header: Adds Phase 2 source records, asset lifecycle state, and update timestamps.

-- Source records preserve raw provider payloads before and after normalization.
CREATE TABLE IF NOT EXISTS source_records (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_part_key TEXT NOT NULL,
  part_id TEXT REFERENCES parts(id),
  source_url TEXT,
  fetched_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB NOT NULL,
  normalized_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_part_key, fetched_at)
);

-- Canonical part rows expose their last update timestamp to API and UI consumers.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Datasheet revisions retain source-record attribution and update timestamps.
ALTER TABLE datasheet_revisions
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Metrics retain source-record attribution and update timestamps in addition to datasheet provenance.
ALTER TABLE part_metrics
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Assets track reference/download/validation state without inventing file availability.
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS asset_state TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- The asset state check keeps the lifecycle values constrained and auditable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assets_asset_state_check'
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT assets_asset_state_check
      CHECK (asset_state IN ('missing', 'referenced', 'downloaded', 'validated', 'failed'));
  END IF;
END $$;

-- Generation workflows track datasheet-driven CAD opportunities without implying output files exist.
CREATE TABLE IF NOT EXISTS generation_workflows (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  target_asset_type TEXT NOT NULL CHECK (target_asset_type IN ('footprint', 'symbol', 'three_d_model')),
  source_datasheet_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  source_asset_id TEXT REFERENCES assets(id),
  generation_status TEXT NOT NULL CHECK (generation_status IN ('ready', 'blocked', 'in_progress', 'completed')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  output_asset_id TEXT REFERENCES assets(id)
);
