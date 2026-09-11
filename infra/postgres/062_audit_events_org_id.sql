-- File header: Tenant-scope the user-action audit log.
--
-- audit_events was intentionally excluded from RLS (migration 055) because the audit flush runs on a
-- dedicated pool after the request transaction may have aborted. That left GET /audit-events as a
-- global cross-tenant read: any org admin received every tenant's actions, paths, and target ids.
--
-- This migration adds org_id so the application can filter reads by the request tenant. Writes stay on
-- the dedicated pool (still no RLS) and persist the acting session's orgId. Historical rows are
-- backfilled from users.org_id when actor_id matches; unauthenticated rows stay NULL and fail closed
-- on read (only rows with org_id = request org are returned).
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate is a no-op.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

UPDATE audit_events ae
SET org_id = u.org_id
FROM users u
WHERE ae.org_id IS NULL
  AND ae.actor_id IS NOT NULL
  AND ae.actor_id = u.id::text
  AND u.org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_org_occurred_at
  ON audit_events(org_id, occurred_at DESC, id DESC);
