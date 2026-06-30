-- File header: Tenant isolation, Increment 2a. Adds org_id to the projects / BOM-memory core tables
-- and backfills existing rows to the default org. The API scopes every project-core read/write by the
-- request's org from here on. Other domains (interconnects, catalog, evidence, circuit blocks, ...)
-- are still global and get scoped in later increments.
--
-- org_id is denormalized onto the child tables (revisions, bom imports/lines, usages) so every query
-- can filter by org directly without a parent join. Nullable + backfilled so the ALTER is non-breaking;
-- a later migration can tighten to NOT NULL once every write path stamps it across all domains.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate reports
-- no pending work.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE project_revisions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE bom_imports ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE project_part_usages ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

-- Backfill existing rows to the shared default org so nothing disappears when scoping turns on.
UPDATE projects SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE project_revisions SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE bom_imports SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE bom_lines SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE project_part_usages SET org_id = 'org-default' WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS projects_org_id_idx ON projects (org_id);
CREATE INDEX IF NOT EXISTS project_revisions_org_id_idx ON project_revisions (org_id);
CREATE INDEX IF NOT EXISTS bom_imports_org_id_idx ON bom_imports (org_id);
CREATE INDEX IF NOT EXISTS bom_lines_org_id_idx ON bom_lines (org_id);
-- Composite: confirmed where-used / overlap reads scan usages by org then part.
CREATE INDEX IF NOT EXISTS project_part_usages_org_part_idx ON project_part_usages (org_id, part_id);
