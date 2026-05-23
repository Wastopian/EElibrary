-- File header: Widens the user role set for RBAC v1 (adds viewer / contributor / approver).
-- This is Phase 1 plumbing only: it makes the new role values VALID, it does not restrict anyone.
-- Existing 'admin' and 'user' rows keep full power, and the default role stays 'user'. Permission
-- enforcement for the new roles is layered on in a later phase; until then any non-admin role
-- behaves exactly like 'user' did before. See docs/IMPLEMENTATION_STATUS.md (Team Collaboration
-- and Governance) and TODO.md §0.

-- Idempotent: drop the prior CHECK (whatever its current allowed set) and re-add the widened one.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'user', 'viewer', 'contributor', 'approver'));
