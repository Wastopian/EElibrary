-- File header: Single-use, expiring teammate invite tokens (hardening backlog).
--
-- The per-org reusable invite code (organizations.invite_code, migration 054) stays valid for
-- backward compatibility, but a team can now issue single-use tokens that expire, so a code that
-- leaks or is over-shared cannot admit an unbounded number of accounts. Each token admits exactly
-- one account: sign-up consumes it with an atomic conditional UPDATE, so two people racing the same
-- token cannot both join.
--
-- Like organizations and users, this table is intentionally NOT under row-level security: sign-up
-- must read/consume a token BEFORE any tenant context exists (the same pre-auth chicken-and-egg
-- exception documented in 055). Post-auth operations (generate, list, revoke) always filter by the
-- acting org_id in application code.

CREATE TABLE IF NOT EXISTS org_invite_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  -- The opaque secret a teammate submits at sign-up. Unique so consumption can target one row.
  token TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set exactly once, by the atomic consume. A non-null value means the token is spent.
  consumed_at TIMESTAMPTZ,
  consumed_by_email TEXT,
  -- Set when a team admin revokes an unused token before it is consumed or expires.
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS org_invite_tokens_token_unique ON org_invite_tokens (token);
CREATE INDEX IF NOT EXISTS org_invite_tokens_org_idx ON org_invite_tokens (org_id, created_at DESC);
