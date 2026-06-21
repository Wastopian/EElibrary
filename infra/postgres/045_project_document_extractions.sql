-- File header: Adds cached background extraction for project PDF and Office documents.
--
-- The API queues new or changed project files; the worker reads them from the shared
-- project-file mirror and stores bounded searchable text plus page/sheet/slide provenance.
-- Extraction is a search aid only and never marks a document reviewed or approved.

CREATE TABLE IF NOT EXISTS project_document_extractions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  extraction_format TEXT NOT NULL CHECK (
    extraction_format IN ('pdf', 'docx', 'xlsx', 'pptx')
  ),
  extractor_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  source_size_bytes BIGINT NOT NULL CHECK (source_size_bytes >= 0),
  source_modified_at TIMESTAMPTZ,
  extraction_status TEXT NOT NULL DEFAULT 'queued' CHECK (
    extraction_status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (
    progress_percent >= 0 AND progress_percent <= 100
  ),
  progress_message TEXT NOT NULL DEFAULT 'Waiting for the document reader.',
  source_unit_count INTEGER CHECK (
    source_unit_count IS NULL OR source_unit_count >= 0
  ),
  extracted_character_count INTEGER NOT NULL DEFAULT 0 CHECK (
    extracted_character_count >= 0
  ),
  extracted_text TEXT,
  extracted_segments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(extracted_segments) = 'array'
  ),
  source_location_previews JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(source_location_previews) = 'array'
  ),
  error_code TEXT,
  error_message TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_project_document_extractions_queue
  ON project_document_extractions(extraction_status, requested_at, id);

CREATE INDEX IF NOT EXISTS idx_project_document_extractions_project
  ON project_document_extractions(project_id, relative_path);
