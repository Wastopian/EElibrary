-- File header: Adds controlled document revision, ACL, and redline foundations.
-- Document control is attached to existing catalog assets so datasheets and drawings
-- keep their stored file provenance while gaining revision, expiry, access, and
-- supersession history.

CREATE TABLE IF NOT EXISTS document_revisions (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  document_type TEXT NOT NULL CHECK (
    document_type IN ('datasheet', 'mechanical_drawing', 'controlled_drawing', 'specification', 'other')
  ),
  revision_label TEXT NOT NULL,
  revision_date DATE,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    lifecycle_status IN ('draft', 'in_review', 'released', 'superseded', 'expired', 'archived')
  ),
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (
    access_level IN ('public', 'internal', 'restricted', 'itar_controlled')
  ),
  access_notes TEXT NOT NULL DEFAULT '',
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  supersedes_document_revision_id TEXT REFERENCES document_revisions(id),
  source_asset_hash TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, asset_id, revision_label)
);

CREATE INDEX IF NOT EXISTS idx_document_revisions_part
  ON document_revisions(part_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_revisions_asset
  ON document_revisions(asset_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_revisions_supersedes
  ON document_revisions(supersedes_document_revision_id);
CREATE INDEX IF NOT EXISTS idx_document_revisions_expiry
  ON document_revisions(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_revisions_access
  ON document_revisions(access_level, lifecycle_status);

CREATE TABLE IF NOT EXISTS document_acl_entries (
  id TEXT PRIMARY KEY,
  document_revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'team', 'role')),
  principal_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'review', 'approve', 'admin')),
  granted_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_revision_id, principal_type, principal_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_document_acl_entries_revision
  ON document_acl_entries(document_revision_id, permission);
CREATE INDEX IF NOT EXISTS idx_document_acl_entries_principal
  ON document_acl_entries(principal_type, principal_id, permission);

CREATE TABLE IF NOT EXISTS document_redlines (
  id TEXT PRIMARY KEY,
  document_revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  redline_status TEXT NOT NULL DEFAULT 'open' CHECK (
    redline_status IN ('open', 'resolved', 'rejected', 'superseded')
  ),
  page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  anchor_text TEXT,
  note TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'review' CHECK (
    severity IN ('info', 'review', 'blocker')
  ),
  created_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_redlines_revision
  ON document_redlines(document_revision_id, redline_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_redlines_status
  ON document_redlines(redline_status, severity, updated_at DESC);
