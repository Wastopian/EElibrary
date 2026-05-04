-- File header: Adds planned project and BOM memory foundation tables without claiming BOM import is fully shipped.
-- These tables preserve project/revision context, raw BOM rows, and confirmed usage history for later where-used and BOM-health workflows.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'archived', 'prototype', 'production', 'deprecated')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_project_key ON projects(project_key);
CREATE INDEX IF NOT EXISTS idx_projects_status_updated_at ON projects(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_label TEXT NOT NULL,
  revision_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    revision_status IN ('draft', 'in_review', 'released', 'superseded', 'archived')
  ),
  source_reference TEXT,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_label)
);

CREATE INDEX IF NOT EXISTS idx_project_revisions_project_status
  ON project_revisions(project_id, revision_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS bom_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_revision_id TEXT NOT NULL REFERENCES project_revisions(id),
  source_filename TEXT NOT NULL,
  source_format TEXT NOT NULL DEFAULT 'csv' CHECK (
    source_format IN ('csv', 'xlsx', 'json', 'eda_export', 'manual')
  ),
  storage_key TEXT,
  import_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (
    import_status IN ('uploaded', 'mapping_required', 'mapped', 'processing', 'processed', 'failed')
  ),
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  import_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bom_imports_project_revision
  ON bom_imports(project_id, project_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_imports_status
  ON bom_imports(import_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS bom_lines (
  id TEXT PRIMARY KEY,
  bom_import_id TEXT NOT NULL REFERENCES bom_imports(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_revision_id TEXT NOT NULL REFERENCES project_revisions(id),
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  designators TEXT[] NOT NULL DEFAULT '{}',
  quantity NUMERIC,
  raw_mpn TEXT,
  raw_manufacturer TEXT,
  raw_description TEXT,
  raw_supplier_reference TEXT,
  raw_notes TEXT,
  raw_row_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched_part_id TEXT REFERENCES parts(id),
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (
    match_status IN ('unmatched', 'matched', 'ambiguous', 'weak_match', 'ignored')
  ),
  match_confidence_score NUMERIC CHECK (
    match_confidence_score IS NULL OR (match_confidence_score >= 0 AND match_confidence_score <= 1)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bom_import_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_bom_lines_import_status
  ON bom_lines(bom_import_id, match_status, row_number);
CREATE INDEX IF NOT EXISTS idx_bom_lines_project_revision
  ON bom_lines(project_id, project_revision_id, row_number);
CREATE INDEX IF NOT EXISTS idx_bom_lines_matched_part
  ON bom_lines(matched_part_id, project_id, project_revision_id);

CREATE TABLE IF NOT EXISTS project_part_usages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_revision_id TEXT NOT NULL REFERENCES project_revisions(id),
  bom_line_id TEXT REFERENCES bom_lines(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  usage_context TEXT,
  designators TEXT[] NOT NULL DEFAULT '{}',
  quantity NUMERIC,
  usage_status TEXT NOT NULL DEFAULT 'proposed' CHECK (
    usage_status IN ('proposed', 'in_review', 'used', 'released', 'deprecated')
  ),
  approval_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  readiness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_part_usages_part
  ON project_part_usages(part_id, usage_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_part_usages_project_revision
  ON project_part_usages(project_id, project_revision_id, usage_status);
CREATE INDEX IF NOT EXISTS idx_project_part_usages_bom_line
  ON project_part_usages(bom_line_id);
