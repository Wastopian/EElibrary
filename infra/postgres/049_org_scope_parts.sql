-- File header: Tenant isolation, Increment 2b. Scopes the parts catalog to the org and backfills
-- existing rows to the default org. Per the decided per-tenant catalog model (docs/MULTITENANCY.md)
-- each org gets its own parts; public part data is duplicated across teams (an accepted cost).
-- manufacturers / packages / connector families stay global. The async worker that creates parts has
-- no request context, so provider_acquisition_jobs also gains org_id: the API stamps the acting org
-- when a job is enqueued and the worker stamps that org onto the part it creates.
--
-- The global (manufacturer_id, mpn) uniqueness becomes per-tenant (org_id, manufacturer_id, mpn) so
-- the same public part can exist once per team. Part ids stay opaque text PKs (no FK re-keying);
-- org-scoped id GENERATION (so two orgs ingesting the same MPN get distinct rows) is deferred to the
-- org-on-signup increment — until then only org-default ingests, so the existing deterministic ids
-- cannot collide across orgs.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate
-- reports no pending work.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
UPDATE parts SET org_id = 'org-default' WHERE org_id IS NULL;

-- Per-tenant identity: drop the global (manufacturer_id, mpn) uniqueness (the inline constraint from
-- 001_core_schema.sql, named by Postgres convention parts_manufacturer_id_mpn_key) and re-key it by
-- org so the same public part can exist once per team.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_manufacturer_id_mpn_key;
CREATE UNIQUE INDEX IF NOT EXISTS parts_org_mfr_mpn_unique ON parts (org_id, manufacturer_id, mpn);

CREATE INDEX IF NOT EXISTS parts_org_id_idx ON parts (org_id);
-- Org-prefixed search index mirrors idx_parts_search_filters (012) for the now org-scoped catalog search.
CREATE INDEX IF NOT EXISTS idx_parts_org_search_filters
  ON parts (org_id, manufacturer_id, category, package_id, lifecycle_status, mpn, id);

ALTER TABLE provider_acquisition_jobs ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
UPDATE provider_acquisition_jobs SET org_id = 'org-default' WHERE org_id IS NULL;
CREATE INDEX IF NOT EXISTS provider_acquisition_jobs_org_id_idx ON provider_acquisition_jobs (org_id);
