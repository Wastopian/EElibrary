# Multi-tenancy

EE Library is moving from a single shared workspace to a **multi-tenant hosted** model so multiple
teams can use one hosted instance without seeing each other's data. This is the foundation for a
public alpha; the product thesis ("your team's private engineering truth") requires it.

## Model decision

- **Per-tenant catalog.** Each organization gets its own isolated data — parts, manufacturers'
  usage, assets, projects, BOMs, circuit blocks, cables, fixtures, evidence, everything a team
  creates or imports. Provider imports (DigiKey / JLC / Mouser / KiCad) populate *that* team's
  catalog. Public part data is duplicated across teams; that is an accepted cost (storage is cheap,
  isolation and the privacy thesis matter more).
- **Pure reference taxonomies stay global** (no team IP): `manufacturers`, `packages`,
  `connector_families`, `connector_family_conflicts`. These are *not* org-scoped.
- **RBAC is unchanged within a tenant** — flat `admin` / `user`. No per-record RBAC rework for alpha.

## The `orgId` contract (Increment 1 — shipped)

Every authenticated request now carries the acting tenant:

1. `users.org_id` (migration `047_organizations.sql`) — the user's organization. A backfilled
   `org-default` organization holds all existing users.
2. NextAuth (`apps/web/src/auth.ts`): `authorize` reads `users.org_id`; the `jwt`/`session`
   callbacks carry `orgId`; `session.user.orgId` is available app-side.
3. The minted API bearer token (`apps/web/src/app/api/token/route.ts` and the `/api-proxy` mint in
   `apps/web/src/middleware.ts`) includes the `orgId` claim.
4. The API (`apps/api/src/auth.ts`) verifies it: `ApiSession.orgId`. During the foundation phase a
   token without the claim **defaults to `org-default`** (non-breaking); the enforcement step will
   require it once every mint path guarantees it.

**Increment 1 introduces no data isolation.** Everyone is in `org-default` and still sees all data.
It is groundwork: the `orgId` is now threaded everywhere so the enforcement step can scope on it.

## Enforcement plan (Increment 2 — not yet built)

1. Add `org_id` to every team-data table (+ backfill to `org-default`); index it.
2. Thread `session.orgId` into every store read/write: **filter** on read, **stamp** on insert. Roll
   out and test domain by domain (catalog → projects → interconnects → the rest).
3. Add Postgres **Row-Level Security** policies as a defense-in-depth backstop, so a forgotten
   `WHERE org_id = ...` cannot leak across tenants. (Requires a per-request `SET LOCAL app.current_org`
   inside a transaction-scoped connection — a store-layer change to design carefully with the pool.)
4. Make sign-up **create a new organization** (first user is its admin); tighten the API to require
   the `orgId` claim. Per-org invites for teammates follow in Increment 3.

## Later

- Increment 3: per-org invite codes/links, basic org management UI.
- Hardening tracks: per-tenant + global rate limiting / abuse controls, onboarding / first-run UX,
  ops (scheduled backup/restore, monitoring, tested upgrade path).
