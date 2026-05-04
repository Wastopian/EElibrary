-- File header: Adds persisted connector family-conflict evidence and cable constraint fields for Phase 6C connector intelligence expansion.

ALTER TABLE cable_compatibilities
  ADD COLUMN IF NOT EXISTS wire_gauge_min INTEGER,
  ADD COLUMN IF NOT EXISTS wire_gauge_max INTEGER,
  ADD COLUMN IF NOT EXISTS shielding_requirement TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS termination_style TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS compatibility_status TEXT NOT NULL DEFAULT 'probable',
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id);

UPDATE cable_compatibilities
SET
  shielding_requirement = COALESCE(shielding_requirement, 'unknown'),
  termination_style = COALESCE(termination_style, 'unknown'),
  compatibility_status = COALESCE(compatibility_status, 'probable')
WHERE shielding_requirement IS NULL OR termination_style IS NULL OR compatibility_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cable_compatibilities_shielding_requirement_check'
  ) THEN
    ALTER TABLE cable_compatibilities
      ADD CONSTRAINT cable_compatibilities_shielding_requirement_check
      CHECK (shielding_requirement IN ('shielded', 'unshielded', 'either', 'unknown'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cable_compatibilities_termination_style_check'
  ) THEN
    ALTER TABLE cable_compatibilities
      ADD CONSTRAINT cable_compatibilities_termination_style_check
      CHECK (termination_style IN ('idc', 'crimp', 'solder', 'unknown'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cable_compatibilities_compatibility_status_check'
  ) THEN
    ALTER TABLE cable_compatibilities
      ADD CONSTRAINT cable_compatibilities_compatibility_status_check
      CHECK (compatibility_status IN ('verified', 'probable', 'uncertain', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cable_compatibilities_wire_gauge_order_check'
  ) THEN
    ALTER TABLE cable_compatibilities
      ADD CONSTRAINT cable_compatibilities_wire_gauge_order_check
      CHECK (wire_gauge_min IS NULL OR wire_gauge_max IS NULL OR wire_gauge_min <= wire_gauge_max);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cable_compatibilities_status
  ON cable_compatibilities (compatibility_status, part_id);

CREATE TABLE IF NOT EXISTS connector_family_conflicts (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  candidate_part_id TEXT NOT NULL,
  candidate_connector_family_id TEXT REFERENCES connector_families(id),
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('near_match_variant', 'family_confusion')),
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  summary TEXT NOT NULL,
  detail TEXT NOT NULL,
  source_record_id TEXT REFERENCES source_records(id),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, candidate_part_id, conflict_type)
);

CREATE INDEX IF NOT EXISTS idx_connector_family_conflicts_part_id
  ON connector_family_conflicts (part_id, conflict_type, last_updated_at);

CREATE INDEX IF NOT EXISTS idx_connector_family_conflicts_candidate_part_id
  ON connector_family_conflicts (candidate_part_id, last_updated_at);
