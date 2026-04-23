-- File header: Adds connector relation evidence fields so mate and accessory confidence can distinguish direct evidence from family inference.

ALTER TABLE mate_relations
  ADD COLUMN IF NOT EXISTS compatibility_status TEXT NOT NULL DEFAULT 'probable',
  ADD COLUMN IF NOT EXISTS evidence_kind TEXT NOT NULL DEFAULT 'catalog_fixture',
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id);

UPDATE mate_relations
SET
  compatibility_status = COALESCE(compatibility_status, 'probable'),
  evidence_kind = COALESCE(evidence_kind, 'catalog_fixture')
WHERE compatibility_status IS NULL OR evidence_kind IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mate_relations_compatibility_status_check'
  ) THEN
    ALTER TABLE mate_relations
      ADD CONSTRAINT mate_relations_compatibility_status_check
      CHECK (compatibility_status IN ('verified', 'probable', 'uncertain', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mate_relations_evidence_kind_check'
  ) THEN
    ALTER TABLE mate_relations
      ADD CONSTRAINT mate_relations_evidence_kind_check
      CHECK (evidence_kind IN ('provider_direct', 'datasheet_reference', 'family_inference', 'manual_review', 'catalog_fixture'));
  END IF;
END $$;

ALTER TABLE accessory_requirements
  ADD COLUMN IF NOT EXISTS compatibility_status TEXT NOT NULL DEFAULT 'probable',
  ADD COLUMN IF NOT EXISTS evidence_kind TEXT NOT NULL DEFAULT 'catalog_fixture',
  ADD COLUMN IF NOT EXISTS source_record_id TEXT REFERENCES source_records(id);

UPDATE accessory_requirements
SET
  compatibility_status = COALESCE(compatibility_status, 'probable'),
  evidence_kind = COALESCE(evidence_kind, 'catalog_fixture')
WHERE compatibility_status IS NULL OR evidence_kind IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accessory_requirements_compatibility_status_check'
  ) THEN
    ALTER TABLE accessory_requirements
      ADD CONSTRAINT accessory_requirements_compatibility_status_check
      CHECK (compatibility_status IN ('verified', 'probable', 'uncertain', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accessory_requirements_evidence_kind_check'
  ) THEN
    ALTER TABLE accessory_requirements
      ADD CONSTRAINT accessory_requirements_evidence_kind_check
      CHECK (evidence_kind IN ('provider_direct', 'datasheet_reference', 'family_inference', 'manual_review', 'catalog_fixture'));
  END IF;
END $$;
