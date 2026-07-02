-- File header: Tenant isolation, Increment 4. Per-org teammate invites. Makes each organization's
-- reusable invite code unique so a code entered at sign-up maps to exactly one team.
--
-- The invite_code column has existed (unused) since 047. Org-on-signup (3b) creates a team per sign-up;
-- this increment lets a teammate join an existing team by entering its code. A partial unique index
-- (only non-null codes) keeps two orgs from sharing a code while still allowing the many orgs that have
-- not generated a code yet to keep a NULL. Codes are generated lazily by the app (at org creation from
-- now on, or via the Team page for pre-existing orgs) — no backfill here.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate reports
-- no pending work.

CREATE UNIQUE INDEX IF NOT EXISTS organizations_invite_code_unique
  ON organizations (invite_code)
  WHERE invite_code IS NOT NULL;
