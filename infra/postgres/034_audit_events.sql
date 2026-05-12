-- File header: Adds the general user-action audit log foundation for API middleware.
-- The table stores route/action/actor/status context only. Request bodies are intentionally
-- excluded so secrets, uploaded evidence bytes, and controlled technical data are not copied
-- into long-lived audit history.

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT,
  actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('admin', 'user')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  operation TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code >= 100 AND status_code <= 599),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  request_ip_hash TEXT,
  user_agent_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON audit_events(occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON audit_events(actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target
  ON audit_events(target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events(action, outcome, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_request
  ON audit_events(request_id);
