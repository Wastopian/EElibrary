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
  generation_status TEXT NOT NULL CHECK (generation_status IN ('ready', 'blocked', 'in_progress', 'completed')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  output_asset_id TEXT REFERENCES assets(id)
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
