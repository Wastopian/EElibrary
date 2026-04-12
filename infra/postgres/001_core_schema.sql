-- File header: Defines the Phase 1 normalized core schema from docs/DATA_MODEL.md.

-- Manufacturer rows preserve official names plus known aliases for search.
CREATE TABLE IF NOT EXISTS manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  website TEXT
);

-- Package rows normalize physical package dimensions in millimeters.
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  pin_count INTEGER,
  pitch_mm NUMERIC,
  body_length_mm NUMERIC,
  body_width_mm NUMERIC,
  body_height_mm NUMERIC
);

-- Part rows link manufacturer and package records while keeping trust explicit.
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  mpn TEXT NOT NULL,
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
  category TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES packages(id),
  trust_score NUMERIC NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
  UNIQUE (manufacturer_id, mpn)
);

-- Asset rows track file availability without implying metadata-only assets are downloadable.
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  asset_type TEXT NOT NULL,
  file_format TEXT NOT NULL,
  storage_key TEXT,
  file_hash TEXT,
  provider_id TEXT,
  license_mode TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  preview_status TEXT NOT NULL
);

-- Datasheet revisions link parsed metrics back to a specific revision and optional asset.
CREATE TABLE IF NOT EXISTS datasheet_revisions (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  revision_label TEXT NOT NULL,
  revision_date DATE,
  page_count INTEGER,
  file_asset_id TEXT REFERENCES assets(id),
  parse_confidence NUMERIC NOT NULL CHECK (parse_confidence >= 0 AND parse_confidence <= 1)
);

-- Metric rows keep normalized values, units, confidence, and datasheet provenance.
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
