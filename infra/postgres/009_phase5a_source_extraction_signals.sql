-- File header: Adds explicit source extraction signals for missing-CAD recovery readiness.

-- Extraction signals are provider-neutral evidence, not generated CAD outputs.
CREATE TABLE IF NOT EXISTS source_extraction_signals (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  source_record_id TEXT REFERENCES source_records(id),
  datasheet_revision_id TEXT REFERENCES datasheet_revisions(id),
  asset_id TEXT REFERENCES assets(id),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('package_mechanical_dimensions', 'pin_table', 'mechanical_drawing')),
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('available', 'needs_review', 'not_available')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  extraction_source TEXT NOT NULL CHECK (extraction_source IN ('provider_structured_metadata', 'datasheet_metadata', 'asset_reference', 'manual_internal')),
  notes TEXT,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detail-read requestability checks need fast part-scoped signal lookup.
CREATE INDEX IF NOT EXISTS idx_source_extraction_signals_part_type ON source_extraction_signals(part_id, signal_type);
CREATE INDEX IF NOT EXISTS idx_source_extraction_signals_source_record ON source_extraction_signals(source_record_id);
CREATE INDEX IF NOT EXISTS idx_source_extraction_signals_datasheet ON source_extraction_signals(datasheet_revision_id);
CREATE INDEX IF NOT EXISTS idx_source_extraction_signals_asset ON source_extraction_signals(asset_id);
