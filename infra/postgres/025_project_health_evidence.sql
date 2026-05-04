-- File header: Adds project-memory evidence attachment metadata for BOM health and decision provenance.
-- Evidence rows preserve reviewable context; they do not imply validation, approval, or export readiness.

CREATE TABLE IF NOT EXISTS evidence_attachments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (
    target_type IN ('part', 'asset', 'project', 'bom_import', 'bom_line', 'project_part_usage', 'risk_finding')
  ),
  target_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (
    evidence_type IN ('note', 'link', 'file')
  ),
  title TEXT NOT NULL,
  source_url TEXT,
  storage_key TEXT,
  file_hash TEXT,
  mime_type TEXT,
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'manual_internal',
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (
    review_status IN ('unreviewed', 'accepted', 'rejected', 'superseded')
  ),
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (evidence_type = 'link' AND source_url IS NOT NULL)
    OR (evidence_type = 'file' AND storage_key IS NOT NULL)
    OR (evidence_type = 'note' AND notes IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_attachments_target
  ON evidence_attachments(target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_attachments_review
  ON evidence_attachments(review_status, updated_at DESC);
