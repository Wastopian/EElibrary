-- File header: Make provider_enrichment_jobs.source_acquisition_job_id optional.
--
-- Enrichment jobs were originally always triggered by a succeeded acquisition job. Datasheet extraction
-- can also be enqueued outside that flow -- by the ingest CLI (which persists directly, no acquisition
-- job) and by future backfills -- so the acquisition reference is now optional. The FK still enforces
-- that a non-null value points at a real acquisition job.

ALTER TABLE provider_enrichment_jobs ALTER COLUMN source_acquisition_job_id DROP NOT NULL;
