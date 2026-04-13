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
  parse_confidence NUMERIC NOT NULL CHECK (parse_confidence >= 0 AND parse_confidence <= 1)
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
  source_datasheet_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
  source_asset_id TEXT REFERENCES assets(id),
  generation_status TEXT NOT NULL CHECK (generation_status IN ('ready', 'blocked', 'in_progress', 'completed')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  output_asset_id TEXT REFERENCES assets(id)
);
