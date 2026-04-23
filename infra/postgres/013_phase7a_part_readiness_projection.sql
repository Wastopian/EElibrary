-- File header: Adds canonical part readiness, approval, issue, and risk projection tables.

CREATE TABLE IF NOT EXISTS part_readiness_summaries (
  part_id TEXT PRIMARY KEY REFERENCES parts(id),
  readiness_status TEXT NOT NULL CHECK (readiness_status IN ('ready_for_export_review', 'needs_attention', 'blocked', 'unknown')),
  identity_status TEXT NOT NULL CHECK (identity_status IN ('confirmed', 'low_confidence', 'unknown')),
  connector_class TEXT NOT NULL CHECK (connector_class IN ('connector', 'accessory', 'tooling', 'cable', 'non_connector')),
  blocker_count INTEGER NOT NULL DEFAULT 0 CHECK (blocker_count >= 0),
  blocker_summary TEXT[] NOT NULL DEFAULT '{}',
  recommended_actions TEXT[] NOT NULL DEFAULT '{}',
  detail TEXT NOT NULL,
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_readiness_summaries_status ON part_readiness_summaries(readiness_status, last_evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_readiness_summaries_connector_class ON part_readiness_summaries(connector_class, last_evaluated_at DESC);

CREATE TABLE IF NOT EXISTS part_approvals (
  part_id TEXT PRIMARY KEY REFERENCES parts(id),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('approved', 'pending_review', 'not_requested', 'not_applicable')),
  summary TEXT NOT NULL,
  detail TEXT NOT NULL,
  evidence TEXT[] NOT NULL DEFAULT '{}',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_approvals_status ON part_approvals(approval_status, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS part_issues (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  issue_code TEXT NOT NULL CHECK (issue_code IN ('low_confidence_identity', 'pending_approval', 'missing_verified_cad', 'missing_datasheet', 'missing_connector_mate', 'missing_connector_accessories', 'connector_low_confidence', 'lifecycle_risk', 'source_conflict')),
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warning')),
  summary TEXT NOT NULL,
  detail TEXT NOT NULL,
  source TEXT NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, issue_code)
);

CREATE INDEX IF NOT EXISTS idx_part_issues_part_id ON part_issues(part_id, severity, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_issues_code ON part_issues(issue_code, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS part_risk_flags (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  risk_code TEXT NOT NULL CHECK (risk_code IN ('lifecycle_not_active', 'generated_assets_present', 'source_conflict', 'connector_low_confidence', 'partial_readiness_data')),
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('review', 'danger')),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, risk_code)
);

CREATE INDEX IF NOT EXISTS idx_part_risk_flags_part_id ON part_risk_flags(part_id, tone, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_risk_flags_code ON part_risk_flags(risk_code, last_updated_at DESC);
