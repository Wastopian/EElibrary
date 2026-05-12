-- File header: Adds versioned BOM revision approval gates for project memory.
-- Gate rows preserve the exact diff fingerprint that was reviewed, while keeping
-- part approval, evidence validation, and export readiness as separate workflows.

CREATE TABLE IF NOT EXISTS project_revision_approval_gates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_project_revision_id TEXT NOT NULL REFERENCES project_revisions(id),
  to_project_revision_id TEXT NOT NULL REFERENCES project_revisions(id),
  gate_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (
    gate_status IN ('pending_review', 'approved', 'changes_requested')
  ),
  diff_fingerprint TEXT NOT NULL,
  diff_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, from_project_revision_id, to_project_revision_id, diff_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_project_revision_approval_gates_project
  ON project_revision_approval_gates(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_revision_approval_gates_target
  ON project_revision_approval_gates(to_project_revision_id, gate_status, updated_at DESC);
