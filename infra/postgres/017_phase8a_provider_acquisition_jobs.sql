-- File header: Adds durable provider acquisition jobs and coarse lifecycle events for admin-gated exact-match intake.

CREATE TABLE IF NOT EXISTS provider_acquisition_jobs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_part_key TEXT NOT NULL,
  requested_lookup TEXT NOT NULL,
  manufacturer_name TEXT,
  mpn TEXT,
  package_name TEXT,
  source_url TEXT,
  match_type TEXT NOT NULL,
  match_confidence NUMERIC NOT NULL,
  job_status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  part_id TEXT REFERENCES parts(id),
  import_outcome TEXT,
  previous_import_status TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_acquisition_jobs_status_requested_at
  ON provider_acquisition_jobs (job_status, requested_at, id);

CREATE INDEX IF NOT EXISTS idx_provider_acquisition_jobs_provider_part
  ON provider_acquisition_jobs (provider_id, provider_part_key, requested_at);

CREATE INDEX IF NOT EXISTS idx_provider_acquisition_jobs_part_completed_at
  ON provider_acquisition_jobs (part_id, completed_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_acquisition_jobs_active_provider_part
  ON provider_acquisition_jobs (provider_id, provider_part_key)
  WHERE job_status IN ('queued', 'running');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_acquisition_jobs_match_type_check'
  ) THEN
    ALTER TABLE provider_acquisition_jobs
      ADD CONSTRAINT provider_acquisition_jobs_match_type_check
      CHECK (match_type IN ('exact_mpn', 'exact_provider_part_id'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_acquisition_jobs_status_check'
  ) THEN
    ALTER TABLE provider_acquisition_jobs
      ADD CONSTRAINT provider_acquisition_jobs_status_check
      CHECK (job_status IN ('queued', 'running', 'succeeded', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_acquisition_jobs_import_outcome_check'
  ) THEN
    ALTER TABLE provider_acquisition_jobs
      ADD CONSTRAINT provider_acquisition_jobs_import_outcome_check
      CHECK (import_outcome IS NULL OR import_outcome IN ('new_import', 'refreshed_existing'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_acquisition_jobs_previous_import_status_check'
  ) THEN
    ALTER TABLE provider_acquisition_jobs
      ADD CONSTRAINT provider_acquisition_jobs_previous_import_status_check
      CHECK (previous_import_status IS NULL OR previous_import_status IN ('imported', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS provider_acquisition_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES provider_acquisition_jobs(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_acquisition_job_events_job_created_at
  ON provider_acquisition_job_events (job_id, created_at);

CREATE INDEX IF NOT EXISTS idx_provider_acquisition_job_events_type_created_at
  ON provider_acquisition_job_events (event_type, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_acquisition_job_events_type_check'
  ) THEN
    ALTER TABLE provider_acquisition_job_events
      ADD CONSTRAINT provider_acquisition_job_events_type_check
      CHECK (event_type IN ('queued', 'running', 'succeeded', 'failed'));
  END IF;
END $$;
