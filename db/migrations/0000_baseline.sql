-- File header: Defines the Phase 2A connector-intelligence schema from docs/DATA_MODEL.md.

CREATE TABLE IF NOT EXISTS manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  website TEXT
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  pin_count INTEGER,
  pitch_mm NUMERIC,
  body_length_mm NUMERIC,
  body_width_mm NUMERIC,
  body_height_mm NUMERIC
);

CREATE TABLE IF NOT EXISTS connector_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  mpn TEXT NOT NULL,
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
  category TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES packages(id),
  connector_family_id TEXT REFERENCES connector_families(id),
  trust_score NUMERIC NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
  UNIQUE (manufacturer_id, mpn)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  asset_type TEXT NOT NULL,
  file_format TEXT NOT NULL,
  storage_key TEXT,
  file_hash TEXT,
  provider_id TEXT,
  license_mode TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('official', 'trusted_external', 'generated', 'manual_internal')),
  availability_status TEXT NOT NULL CHECK (availability_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed')),
  review_status TEXT NOT NULL CHECK (review_status IN ('not_reviewed', 'review_required', 'approved', 'rejected', 'changes_requested')),
  export_status TEXT NOT NULL CHECK (export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')),
  asset_status TEXT NOT NULL CHECK (asset_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed', 'reviewed', 'verified_for_export')),
  generation_method TEXT,
  generation_source_asset_id TEXT REFERENCES assets(id),
  validation_status TEXT NOT NULL,
  preview_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasheet_revisions (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  revision_label TEXT NOT NULL,
  revision_date DATE,
  page_count INTEGER,
  file_asset_id TEXT REFERENCES assets(id),
  parse_confidence NUMERIC NOT NULL CHECK (parse_confidence >= 0 AND parse_confidence <= 1),
  pin_table_status TEXT NOT NULL DEFAULT 'not_available' CHECK (pin_table_status IN ('not_available', 'available', 'needs_review'))
);

CREATE TABLE IF NOT EXISTS part_metrics (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  metric_key TEXT NOT NULL,
  metric_value NUMERIC,
  unit TEXT NOT NULL,
  min_value NUMERIC,
  max_value NUMERIC,
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  UNIQUE (part_id, metric_key, source_revision_id)
);

CREATE TABLE IF NOT EXISTS mate_relations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  mate_part_id TEXT NOT NULL REFERENCES parts(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('best_mate', 'alternate_mate')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS accessory_requirements (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  accessory_part_id TEXT NOT NULL REFERENCES parts(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('requires_accessory', 'optional_accessory', 'tooling_requirement')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cable_compatibilities (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  cable_part_id TEXT NOT NULL REFERENCES parts(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('supports_cable')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS similar_part_relations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  similar_part_id TEXT NOT NULL REFERENCES parts(id),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companion_recommendations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  companion_part_id TEXT NOT NULL REFERENCES parts(id),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  usage_context TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_workflows (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  target_asset_type TEXT NOT NULL CHECK (target_asset_type IN ('footprint', 'symbol', 'three_d_model')),
  source_datasheet_revision_id TEXT REFERENCES datasheet_revisions(id),
  source_asset_id TEXT REFERENCES assets(id),
  generation_status TEXT NOT NULL CHECK (generation_status IN ('unavailable', 'available_to_request', 'requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  output_asset_id TEXT REFERENCES assets(id)
);

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
-- File header: Safely upgrades older databases for connector intelligence and explicit asset provenance.

-- Source records may be absent on databases created before the Phase 2 asset registry migration.
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

-- Connector families are normalized so relationship rows stay provider-neutral.
CREATE TABLE IF NOT EXISTS connector_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  description TEXT NOT NULL
);

-- Older part rows need an optional connector-family pointer and update timestamp.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS connector_family_id TEXT REFERENCES connector_families(id),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Datasheets and metrics retain raw source attribution when it is known.
ALTER TABLE datasheet_revisions
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE part_metrics
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Assets get explicit lifecycle, provenance, review/export, generation, and source fields.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_state TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE assets ADD COLUMN IF NOT EXISTS provenance TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_status TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS generation_method TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS generation_source_asset_id TEXT REFERENCES assets(id);

-- Existing assets are conservatively backfilled from real file and validation evidence.
UPDATE assets
SET asset_state = CASE
  WHEN validation_status = 'failed' THEN 'failed'
  WHEN storage_key IS NOT NULL AND file_hash IS NOT NULL AND validation_status = 'verified' THEN 'validated'
  WHEN storage_key IS NOT NULL AND file_hash IS NOT NULL THEN 'downloaded'
  WHEN source_url IS NOT NULL THEN 'referenced'
  ELSE 'missing'
END
WHERE asset_state IS NULL
  OR (asset_state = 'missing' AND (validation_status = 'failed' OR storage_key IS NOT NULL OR file_hash IS NOT NULL OR source_url IS NOT NULL));

-- Older rows did not carry provenance, so the safe default is internal/manual review required.
UPDATE assets
SET provenance = 'manual_internal'
WHERE provenance IS NULL;

-- Review/export status intentionally does not backfill to verified_for_export.
UPDATE assets
SET asset_status = CASE
  WHEN validation_status = 'failed' OR asset_state = 'failed' THEN 'failed'
  WHEN asset_state = 'validated' THEN 'validated'
  WHEN asset_state = 'downloaded' THEN 'downloaded'
  WHEN asset_state = 'referenced' THEN 'referenced'
  ELSE 'missing'
END
WHERE asset_status IS NULL;

ALTER TABLE assets
  ALTER COLUMN asset_state SET DEFAULT 'missing',
  ALTER COLUMN asset_state SET NOT NULL,
  ALTER COLUMN provenance SET DEFAULT 'manual_internal',
  ALTER COLUMN provenance SET NOT NULL,
  ALTER COLUMN asset_status SET DEFAULT 'missing',
  ALTER COLUMN asset_status SET NOT NULL;

-- Constraint recreation makes upgraded databases match the current asset state contract.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_state_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_state_check CHECK (asset_state IN ('missing', 'referenced', 'downloaded', 'validated', 'failed'));

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_provenance_check;
ALTER TABLE assets ADD CONSTRAINT assets_provenance_check CHECK (provenance IN ('official', 'trusted_external', 'generated', 'manual_internal'));

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_status_check CHECK (asset_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed', 'reviewed', 'verified_for_export'));

-- Direct mating relationships support best/alternate mate connector intelligence.
CREATE TABLE IF NOT EXISTS mate_relations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  mate_part_id TEXT NOT NULL REFERENCES parts(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('best_mate', 'alternate_mate')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  notes TEXT
);

-- Accessory rows model required, optional, and tooling relationships separately.
CREATE TABLE IF NOT EXISTS accessory_requirements (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  accessory_part_id TEXT NOT NULL REFERENCES parts(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('requires_accessory', 'optional_accessory', 'tooling_requirement')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  notes TEXT
);

-- Cable compatibility stays typed so the UI never has to infer provider-specific rules.
CREATE TABLE IF NOT EXISTS cable_compatibilities (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  cable_part_id TEXT NOT NULL REFERENCES parts(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('supports_cable')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  notes TEXT
);

-- Similar and companion relationships support non-connector recommendations without overclaiming fit.
CREATE TABLE IF NOT EXISTS similar_part_relations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  similar_part_id TEXT NOT NULL REFERENCES parts(id),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companion_recommendations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  companion_part_id TEXT NOT NULL REFERENCES parts(id),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  usage_context TEXT NOT NULL
);

-- Generation workflows track opportunities and outputs without making generated files official.
CREATE TABLE IF NOT EXISTS generation_workflows (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  target_asset_type TEXT NOT NULL CHECK (target_asset_type IN ('footprint', 'symbol', 'three_d_model')),
  source_datasheet_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  source_asset_id TEXT REFERENCES assets(id),
  generation_status TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  output_asset_id TEXT REFERENCES assets(id),
  CONSTRAINT generation_workflows_generation_status_check CHECK (generation_status IN ('ready', 'blocked', 'in_progress', 'completed'))
);

-- Relationship indexes keep the API detail path scoped to the requested part.
CREATE INDEX IF NOT EXISTS idx_assets_part_id ON assets(part_id);
CREATE INDEX IF NOT EXISTS idx_datasheet_revisions_part_id ON datasheet_revisions(part_id);
CREATE INDEX IF NOT EXISTS idx_part_metrics_part_id ON part_metrics(part_id);
CREATE INDEX IF NOT EXISTS idx_source_records_part_id ON source_records(part_id);
CREATE INDEX IF NOT EXISTS idx_mate_relations_part_id ON mate_relations(part_id);
CREATE INDEX IF NOT EXISTS idx_accessory_requirements_part_id ON accessory_requirements(part_id);
CREATE INDEX IF NOT EXISTS idx_cable_compatibilities_part_id ON cable_compatibilities(part_id);
CREATE INDEX IF NOT EXISTS idx_similar_part_relations_part_id ON similar_part_relations(part_id);
CREATE INDEX IF NOT EXISTS idx_companion_recommendations_part_id ON companion_recommendations(part_id);
CREATE INDEX IF NOT EXISTS idx_generation_workflows_part_id ON generation_workflows(part_id);
-- File header: Adds Phase 3A asset pipeline lookup indexes for part detail and generation workflows.

-- Part detail reads group assets by part and asset class.
CREATE INDEX IF NOT EXISTS idx_assets_part_id_asset_type ON assets(part_id, asset_type);

-- Generation options are resolved by part and target asset class.
CREATE INDEX IF NOT EXISTS idx_generation_workflows_part_id_target_asset_type ON generation_workflows(part_id, target_asset_type);
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
-- File header: Adds low-risk indexes for Phase 5E operational diagnostics and worker queues.

-- Draft generation scans pending requests by status and target before oldest-first processing.
CREATE INDEX IF NOT EXISTS idx_generation_requests_status_target_requested_at ON generation_requests(request_status, target_asset_type, requested_at ASC, id ASC);

-- Draft generation chooses the best extraction signal for a part, target, and usable extraction state.
CREATE INDEX IF NOT EXISTS idx_source_extraction_signals_generation_lookup ON source_extraction_signals(part_id, signal_type, extraction_status, confidence_score DESC, last_updated_at DESC);

-- Local diagnostics list recent generation workflow activity without scanning every workflow row first.
CREATE INDEX IF NOT EXISTS idx_generation_workflows_status_part ON generation_workflows(generation_status, part_id);

-- Local diagnostics list recent validation evidence and promotion attempts by freshness and outcome.
CREATE INDEX IF NOT EXISTS idx_asset_validation_records_validated_at ON asset_validation_records(validated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_promotion_audits_outcome_created_at ON asset_promotion_audits(promotion_outcome, created_at DESC, id DESC);
-- File header: Adds low-risk indexes for SQL-backed Phase 6B search and pagination.

-- Search filters and stable MPN sorting start from canonical part identity.
CREATE INDEX IF NOT EXISTS idx_parts_search_mpn_id ON parts(mpn, id);

-- Common filter combinations include manufacturer, category, package, lifecycle, and stable MPN order.
CREATE INDEX IF NOT EXISTS idx_parts_search_filters ON parts(manufacturer_id, category, package_id, lifecycle_status, mpn, id);

-- Recently-updated and trust-score sorts keep deterministic tie-breaks by MPN and id.
CREATE INDEX IF NOT EXISTS idx_parts_search_updated ON parts(last_updated_at DESC, mpn ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_parts_search_trust ON parts(trust_score DESC, mpn ASC, id ASC);

-- CAD availability filters check verified file-backed CAD evidence without scanning every asset row.
CREATE INDEX IF NOT EXISTS idx_assets_search_cad_export ON assets(part_id, asset_type, availability_status, export_status, validation_status);

-- File header: Adds auth users table for NextAuth credentials provider.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
