-- File header: Multi-tenant foundation (Increment 1). Adds an organizations table and an org_id
-- on users, with a backfilled default org. This is non-breaking groundwork: it does NOT yet scope
-- any team data. Data-table org scoping + row-level isolation arrive in a later enforcement migration.
--
-- Idempotent: production applies migrations on every deploy, and CI asserts a second db:migrate
-- reports no pending work.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  invite_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique ON organizations (slug);

-- The default organization every existing user and (for now) every new sign-up belongs to.
-- Guarded INSERT instead of ON CONFLICT so the migration replays cleanly.
INSERT INTO organizations (id, name, slug)
SELECT 'org-default', 'Default Team', 'default'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'org-default');

-- Nullable for now so the ALTER is non-breaking; backfilled immediately below. A later enforcement
-- migration can tighten this to NOT NULL once every write path stamps org_id.
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

UPDATE users SET org_id = 'org-default' WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS users_org_id_idx ON users (org_id);
