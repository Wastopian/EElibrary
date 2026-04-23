-- File header: Adds issue workflow metadata and source reconciliation persistence for admin operations.

ALTER TABLE part_issues
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE part_issues DROP CONSTRAINT IF EXISTS part_issues_code_check;
ALTER TABLE part_issues DROP CONSTRAINT IF EXISTS part_issues_status_check;

ALTER TABLE part_issues
  ADD CONSTRAINT part_issues_code_check CHECK (
    issue_code IN (
      'low_confidence_identity',
      'pending_approval',
      'missing_verified_cad',
      'missing_datasheet',
      'missing_connector_mate',
      'missing_connector_accessories',
      'connector_low_confidence',
      'lifecycle_risk',
      'source_conflict',
      'duplicate_candidate'
    )
  ),
  ADD CONSTRAINT part_issues_status_check CHECK (
    status IN ('open', 'in_review', 'resolved', 'ignored')
  );

CREATE INDEX IF NOT EXISTS idx_part_issues_status ON part_issues(status, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS part_source_reconciliations (
  part_id TEXT PRIMARY KEY REFERENCES parts(id),
  preferred_source_record_id TEXT REFERENCES source_records(id),
  resolution_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (
    resolution_status IN ('unreviewed', 'canonical_source_selected', 'mixed_sources_accepted')
  ),
  notes TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_source_reconciliations_status
  ON part_source_reconciliations(resolution_status, updated_at DESC);
