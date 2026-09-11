-- File header: Scope the active provider-acquisition unique index by org.
--
-- Active jobs were unique on (provider_id, provider_part_key) with no org_id. The API request path
-- uses RLS, so a second tenant's INSERT hit that global index, the duplicate-recovery SELECT saw
-- none of the first tenant's rows, and the request failed. Acquisition is processed by CLI rather
-- than the daemon, so a queued job can block every other tenant from importing the same distributor
-- part until it leaves queued/running.

UPDATE provider_acquisition_jobs SET org_id = 'org-default' WHERE org_id IS NULL;

DROP INDEX IF EXISTS uq_provider_acquisition_jobs_active_provider_part;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_acquisition_jobs_active_org_provider_part
  ON provider_acquisition_jobs (org_id, provider_id, provider_part_key)
  WHERE job_status IN ('queued', 'running');
