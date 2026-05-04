-- File header: Adds persistent follow-up records for computed BOM health and circuit-block readiness gaps.
-- Follow-ups preserve assignable work state without changing underlying approval, evidence, validation, or export readiness.

CREATE TABLE IF NOT EXISTS follow_up_records (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (
    target_type IN ('project', 'circuit_block')
  ),
  target_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('bom_health', 'circuit_block_gap')
  ),
  source_finding_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  next_action TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN ('review', 'danger')
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'in_progress', 'resolved', 'dismissed')
  ),
  assigned_to TEXT,
  source_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_attachment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (target_type, target_id, source_type, source_finding_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_records_target
  ON follow_up_records(target_type, target_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_up_records_status
  ON follow_up_records(status, severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_up_records_source
  ON follow_up_records(source_type, source_finding_id);
