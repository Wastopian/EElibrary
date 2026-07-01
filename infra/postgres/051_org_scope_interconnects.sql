-- File header: Tenant isolation, Increment 2d. Scopes the interconnect-memory domain (cable
-- assemblies, test fixtures, pin maps) to the org. Until now these were global — any signed-in user
-- could read or edit any team's cables/fixtures/pin maps, and the global where-used workspace surfaced
-- interconnect hits from every org. org_id is denormalized onto every table (children carry it too)
-- so the API can filter directly without a parent join.
--
-- cable_assemblies / test_fixtures have a nullable project_id (they can be standalone), so org cannot
-- always be derived from a project — it is stored on each row, backfilled from the linked project when
-- present and org-default otherwise. The global (cable_key, revision_label) / (fixture_key,
-- revision_label) uniqueness becomes per-tenant so two orgs can hold the same key.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate reports
-- no pending work.

-- 1) Add org_id to every interconnect table.
ALTER TABLE cable_assemblies ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE cable_assembly_ends ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE test_fixtures ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE fixture_ports ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE cable_pin_map_rows ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

-- 2) Backfill the parents from their linked project, then their children from the parent.
UPDATE cable_assemblies c SET org_id = p.org_id FROM projects p WHERE p.id = c.project_id AND c.org_id IS NULL;
UPDATE test_fixtures f SET org_id = p.org_id FROM projects p WHERE p.id = f.project_id AND f.org_id IS NULL;

-- Standalone (no project) parents fall back to the shared default org.
UPDATE cable_assemblies SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE test_fixtures SET org_id = 'org-default' WHERE org_id IS NULL;

UPDATE cable_assembly_ends e SET org_id = c.org_id FROM cable_assemblies c WHERE c.id = e.cable_assembly_id AND e.org_id IS NULL;
UPDATE cable_pin_map_rows r SET org_id = c.org_id FROM cable_assemblies c WHERE c.id = r.cable_assembly_id AND r.org_id IS NULL;
UPDATE fixture_ports fp SET org_id = f.org_id FROM test_fixtures f WHERE f.id = fp.fixture_id AND fp.org_id IS NULL;

-- Any orphaned children fall back to the shared default org.
UPDATE cable_assembly_ends SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE cable_pin_map_rows SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE fixture_ports SET org_id = 'org-default' WHERE org_id IS NULL;

-- 3) Per-tenant identity: drop the global uniqueness (inline constraints from 044, named by Postgres
-- convention) and re-key it by org so the same key can exist once per team.
ALTER TABLE cable_assemblies DROP CONSTRAINT IF EXISTS cable_assemblies_cable_key_revision_label_key;
ALTER TABLE test_fixtures DROP CONSTRAINT IF EXISTS test_fixtures_fixture_key_revision_label_key;
CREATE UNIQUE INDEX IF NOT EXISTS cable_assemblies_org_key_revision_unique ON cable_assemblies (org_id, cable_key, revision_label);
CREATE UNIQUE INDEX IF NOT EXISTS test_fixtures_org_key_revision_unique ON test_fixtures (org_id, fixture_key, revision_label);

-- 4) Index org_id on every scoped table.
CREATE INDEX IF NOT EXISTS cable_assemblies_org_id_idx ON cable_assemblies (org_id);
CREATE INDEX IF NOT EXISTS cable_assembly_ends_org_id_idx ON cable_assembly_ends (org_id);
CREATE INDEX IF NOT EXISTS test_fixtures_org_id_idx ON test_fixtures (org_id);
CREATE INDEX IF NOT EXISTS fixture_ports_org_id_idx ON fixture_ports (org_id);
CREATE INDEX IF NOT EXISTS cable_pin_map_rows_org_id_idx ON cable_pin_map_rows (org_id);
