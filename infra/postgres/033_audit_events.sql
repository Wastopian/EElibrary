-- File header: Adds the audit_events table that records who did what across the API.
-- Append-only at the application layer; future hardening will add row-level security
-- and optional cryptographic chain hashing. See docs/AUDIT_LOG_DESIGN.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  actor_user_id UUID REFERENCES users(id),
  actor_email TEXT,
  actor_role TEXT,
  actor_ip TEXT,
  actor_user_agent TEXT,

  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  result_status TEXT NOT NULL,

  route TEXT,
  request_id TEXT,
  reason TEXT,

  before_state JSONB,
  after_state JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor    ON audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity   ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action   ON audit_events (action, occurred_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_result_status_check'
  ) THEN
    ALTER TABLE audit_events
      ADD CONSTRAINT audit_events_result_status_check
      CHECK (result_status IN ('success', 'denied', 'failed'));
  END IF;
END $$;
