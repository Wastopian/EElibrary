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

## Enforcement plan (Increment 2)

The enforcement mechanism plus the first scoped domains shipped in **Increment 2a** (project-core)
and **Increment 2b** (catalog/parts core), below. The remaining steps (the rest of the catalog
child tables, other domains, RLS, org-on-signup) are still pending.

1. Add `org_id` to every team-data table (+ backfill to `org-default`); index it. — *done for the
   project-core tables and `parts` / `provider_acquisition_jobs`; pending for the rest.*
2. Thread `session.orgId` into every store read/write: **filter** on read, **stamp** on insert. Roll
   out and test domain by domain (projects → catalog → interconnects → the rest). — *done for
   project-core and the parts catalog (read/search/detail + the worker that creates parts).*
3. Add Postgres **Row-Level Security** policies as a defense-in-depth backstop, so a forgotten
   `WHERE org_id = ...` cannot leak across tenants. (Requires a per-request `SET LOCAL app.current_org`
   inside a transaction-scoped connection — a store-layer change to design carefully with the pool;
   today there are ~8 separate per-store pools that must be centralized first.) — *pending.*
4. Make sign-up **create a new organization** (first user is its admin); tighten the API to require
   the `orgId` claim. Per-org invites for teammates follow in Increment 3. — *pending.*

### Increment 2a — scoping mechanism + projects/BOM core (shipped)

- **Mechanism.** A per-request tenant context (`apps/api/src/request-context.ts`) carries `orgId`
  through the async call stack via `AsyncLocalStorage`. `handleRequest` resolves the acting org once
  (test session → `org-default`, else the verified bearer token's `orgId` claim, else `null`) and
  wraps the whole request in `runWithRequestContext`. Store queries read it with `getRequestOrgId()`;
  writes use `requireRequestOrgId()`.
- **Fail-closed.** A read with no tenant (`null`) matches no rows (its `org_id = $orgId` param is
  null, so the equality is never true) and returns empty / `not_found`; a write throws. There is no
  "default to `org-default` on null" — an anonymous request sees nothing.
- **Scope (this increment): project-core only** — `projects`, `project_revisions`, `bom_imports`,
  `bom_lines`, `project_part_usages` (migration `048_org_scope_projects.sql`, `org_id` denormalized
  onto the child tables so every query filters directly without a parent join). Every read of these
  tables is either filtered by `org_id` or gated by an org-scoped `projectExists` / `bomImportExists`
  check; every write stamps `org_id`. Cross-project reuse signals (overlap ranking, part where-used,
  the global where-used workspace, the BOM-match lifecycle-risk draft, connector/mate usage counts)
  are filtered by org so they never leak another tenant's usage.
- **Still global this increment** (accepted transitional state): catalog/parts, interconnects,
  circuit blocks, evidence, documents, engineering memory, export bundles. A scoped project can still
  reference a globally-visible part until the catalog domain is scoped. Reference taxonomies
  (manufacturers, packages, connector families) stay global by design.
- **Proof.** Two-context unit tests in `project-memory-store.test.ts` assert a project created under
  org A is invisible to org B (list/detail/usages/BOM), anonymous reads return nothing and anonymous
  writes throw, a cross-tenant update is a no-op, and overlap / where-used never surface another org's
  projects. Full cross-org isolation in the browser awaits org-on-signup (step 4); today every user
  is `org-default`.

### Increment 2b — catalog/parts core + worker (shipped)

- **Per-tenant identity.** `parts` gains `org_id` (migration `049_org_scope_parts.sql`); the global
  `(manufacturer_id, mpn)` uniqueness becomes per-tenant `(org_id, manufacturer_id, mpn)` so each team
  can hold its own copy of a public part. Part **ids stay opaque** (no FK re-keying); existing rows
  backfill to `org-default`. Org-scoped id *generation* (so two orgs ingesting the same MPN get
  distinct ids) is deferred to org-on-signup — until then only `org-default` ingests, so the existing
  deterministic ids cannot collide.
- **Reads scoped.** Catalog search/facets (`buildSearchSqlFilter` call sites), detail, full-catalog,
  and connector-intent reads filter `parts.org_id`; the asset-download / preview-artifact gates verify
  the part is the org's. The cross-domain `parts` ripple is scoped too: `partExists` and the
  BOM-match-by-MPN / connector pickers / where-used part matchers in `project-memory-store.ts` (plus
  `supply-offers.ts` and `document-control.ts` part gates) only ever resolve the acting org's catalog.
- **Worker write path.** Parts are created asynchronously by the worker (`catalog-repository.ts`
  `persistPart`), which has no request context. `provider_acquisition_jobs` gains `org_id` (stamped by
  the API at enqueue via `requireRequestOrgId()`); the worker reads it on claim and threads it
  (`runProviderPartImport(..., orgId)` → `persistPart`) so the new part is stamped with the job's org.
  `org_id` is intentionally not in `persistPart`'s `ON CONFLICT` update, so a re-ingest never changes
  ownership. **Manufacturers / packages / connector families stay global.**
- **Still global this increment** (accepted transitional state): the ~30 part-attached child tables
  (assets, approvals, readiness, supply offerings, datasheets/documents, connector-intelligence,
  issues, risk flags, reviews, engineering records). They are keyed by the now-org-scoped part, so
  they are partitioned-by-association until scoped in follow-ups. The catalog is now tenant-private —
  anonymous browse returns nothing (the seed fallback still serves demo data when the DB is
  unconfigured).
- **Proof.** `provider-import-db.test.ts` asserts a part owned by org A is invisible to org B's
  search/detail, anonymous reads see nothing, and each org resolves only its own copy of a shared MPN;
  `provider-acquisition-jobs.test.ts` asserts the worker threads the claimed job's org into the part
  import.

## Later

- Increment 3: per-org invite codes/links, basic org management UI.
- Hardening tracks: per-tenant + global rate limiting / abuse controls, onboarding / first-run UX,
  ops (scheduled backup/restore, monitoring, tested upgrade path).
