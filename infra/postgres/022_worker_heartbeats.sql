-- File header: Tracks worker daemon heartbeats so api/web can show worker liveness.
-- A row exists per worker_id; the daemon updates last_seen_at on a periodic interval.

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB
);

-- Cheap lookups by recency for the system-health endpoint.
CREATE INDEX IF NOT EXISTS worker_heartbeats_last_seen_idx ON worker_heartbeats (last_seen_at DESC);
