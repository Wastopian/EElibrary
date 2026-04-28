-- File header: Adds the local admin users table used by seed:admin and future auth flows.

-- Admin user rows hold credentials produced by scripts/lib/auth.mjs (scrypt-hashed).
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lower-case email lookups stay fast even with mixed-case input.
CREATE INDEX IF NOT EXISTS admin_users_email_lower_idx ON admin_users (LOWER(email));
