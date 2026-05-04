-- 030_part_substitutions: Adds engineering-signed-off part substitution records.
--
-- A substitution links one catalog part (original) to another catalog part (substitute) with
-- an explicit scope, sign-off note, and approver. Substitutions DO NOT change part approval,
-- validation, lifecycle, or export readiness. They are decision records that BOM matching can
-- surface as triage hints, not automatic confirmations.

CREATE TABLE IF NOT EXISTS part_substitutions (
  id TEXT PRIMARY KEY,
  original_part_id TEXT NOT NULL REFERENCES parts(id),
  substitute_part_id TEXT NOT NULL REFERENCES parts(id),
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project')),
  project_id TEXT REFERENCES projects(id),
  signoff_notes TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  CONSTRAINT part_substitutions_no_self_substitution CHECK (original_part_id <> substitute_part_id),
  CONSTRAINT part_substitutions_project_scope_consistency CHECK (
    (scope = 'global' AND project_id IS NULL)
    OR (scope = 'project' AND project_id IS NOT NULL)
  )
);

-- One active approval per (original, substitute, optional project) tuple. Revoked rows can stack as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_part_substitutions_active
  ON part_substitutions(original_part_id, substitute_part_id, COALESCE(project_id, ''))
  WHERE approval_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_part_substitutions_original
  ON part_substitutions(original_part_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_part_substitutions_substitute
  ON part_substitutions(substitute_part_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_part_substitutions_project
  ON part_substitutions(project_id, approval_status)
  WHERE project_id IS NOT NULL;
