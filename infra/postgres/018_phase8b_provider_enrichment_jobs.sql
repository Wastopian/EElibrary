-- File header: Adds durable provider enrichment jobs and coarse lifecycle events for post-acquisition background work.

CREATE TABLE IF NOT EXISTS provider_enrichment_jobs (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  source_acquisition_job_id TEXT NOT NULL REFERENCES provider_acquisition_jobs(id),
  job_type TEXT NOT NULL,
  job_status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_enrichment_jobs_active_part_job_type
  ON provider_enrichment_jobs (part_id, job_type)
  WHERE job_status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_provider_enrichment_jobs_status_requested_at
  ON provider_enrichment_jobs (job_status, requested_at, id);

CREATE INDEX IF NOT EXISTS idx_provider_enrichment_jobs_part_requested_at
  ON provider_enrichment_jobs (part_id, requested_at, id);

CREATE INDEX IF NOT EXISTS idx_provider_enrichment_jobs_source_acquisition_job
  ON provider_enrichment_jobs (source_acquisition_job_id, requested_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_enrichment_jobs_type_check'
  ) THEN
    ALTER TABLE provider_enrichment_jobs
      ADD CONSTRAINT provider_enrichment_jobs_type_check
      CHECK (job_type IN ('datasheet_capture'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_enrichment_jobs_status_check'
  ) THEN
    ALTER TABLE provider_enrichment_jobs
      ADD CONSTRAINT provider_enrichment_jobs_status_check
      CHECK (job_status IN ('queued', 'running', 'succeeded', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS provider_enrichment_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES provider_enrichment_jobs(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_enrichment_job_events_job_created_at
  ON provider_enrichment_job_events (job_id, created_at);

CREATE INDEX IF NOT EXISTS idx_provider_enrichment_job_events_type_created_at
  ON provider_enrichment_job_events (event_type, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_enrichment_job_events_type_check'
  ) THEN
    ALTER TABLE provider_enrichment_job_events
      ADD CONSTRAINT provider_enrichment_job_events_type_check
      CHECK (event_type IN ('queued', 'running', 'succeeded', 'failed'));
  END IF;
END $$;
