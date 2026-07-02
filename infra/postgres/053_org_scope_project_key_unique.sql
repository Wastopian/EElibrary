-- File header: Tenant isolation, Increment 3a. Makes the project key uniqueness per-tenant.
--
-- `uq_projects_project_key` (from 024) enforced globally-unique project keys. Once org-on-signup lands
-- and multiple orgs exist, two teams must each be able to use the same project key (e.g. "MAINBOARD").
-- Circuit-block keys were already re-keyed per-tenant in 052; this applies the same treatment to
-- projects, which the org-scoped project-id generation depends on. Reads are already org-scoped (2a),
-- so this only relaxes a cross-tenant constraint — it never widens visibility.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate reports
-- no pending work.

DROP INDEX IF EXISTS uq_projects_project_key;
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_project_key_unique ON projects (org_id, project_key);
