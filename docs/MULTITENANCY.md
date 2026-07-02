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

The enforcement mechanism plus the scoped domains shipped in **Increment 2a** (project-core),
**2b** (catalog/parts core), **2c** (part-attached catalog child tables), **2d** (interconnect
memory), and **2e** (the last app domains), below. After 2e **every team-data table carries `org_id`
and the whole app is tenant-isolated at the app layer**; the only remaining steps are the RLS backstop
and org-on-signup.

1. Add `org_id` to every team-data table (+ backfill to `org-default`); index it. — *done for the
   project-core tables, `parts` / `provider_acquisition_jobs`, the ~22 part-attached catalog child
   tables (migration `050`), the interconnect tables (migration `051`), and the last app domains —
   circuit blocks (+ parts/known-risks/instantiations), evidence, follow-ups, engineering memory,
   substitutions, approval gates, export bundles, and document-extractions (migration `052`). **All
   team-data tables are now scoped.***
2. Thread `session.orgId` into every store read/write: **filter** on read, **stamp** on insert. Roll
   out and test domain by domain (projects → catalog → interconnects → the rest). — *done for every
   app domain.*
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

### Increment 2c — part-attached catalog child tables (shipped)

- **What.** Every part-attached child table now carries `org_id` (migration `050`), backfilled from
  its parent part (`price_breaks` via `supply_offerings`; document ACL/redlines via `document_revisions`).
  This completes the catalog data model for the future RLS backstop and guarantees no tenant-less child
  rows. **`connector_family_conflicts` stays global** (a family-level taxonomy), as do the reference
  taxonomies.
- **Why it's not a leak fix.** 2b already routed every catalog read through an org-scoped parts query,
  so the children were already partitioned-by-association. This increment is **RLS-readiness +
  write-hygiene**; the `*_ROWS_SQL` child reads are intentionally left un-filtered (RLS will enforce
  `org_id` centrally rather than via ~20 per-query edits).
- **Write-stamping.** The worker stamps children via a single post-pass
  (`stampPartChildOrgIds`, `apps/worker/src/catalog-repository.ts`) that derives the org from the
  part itself and only fills `org_id IS NULL` rows — so a re-ingest/refresh by any caller never
  re-owns an existing child (matching `persistPart`'s ownership rule). API request paths
  (`createReview`, `promoteAsset`, source-reconciliation, the projection refresh in `catalog-store.ts`,
  and `document-control.ts`) stamp `requireRequestOrgId()` on insert.
- **Proof.** `catalog-repository.test.ts` asserts a part's child rows (source record, readiness
  projection) inherit the part's org and that a re-ingest under a different org preserves ownership.

### Increment 2d — interconnect memory (shipped)

- **What.** The 5 interconnect tables (`cable_assemblies`, `cable_assembly_ends`, `test_fixtures`,
  `fixture_ports`, `cable_pin_map_rows`) gain `org_id` (migration `051`), denormalized onto the child
  tables so every query filters directly. This closes a **live cross-tenant leak** — before it, any
  signed-in user could read or edit any org's cables/fixtures/pin maps, and the global where-used
  workspace surfaced interconnect hits from every org.
- **Backfill / identity.** `cable_assemblies` / `test_fixtures` have a nullable `project_id`, so org is
  stored per-row: backfilled from the linked project when present, else `org-default`; children from
  their parent. The global `(cable_key, revision_label)` / `(fixture_key, revision_label)` uniqueness
  becomes per-tenant.
- **Store (`apps/api/src/interconnect-store.ts`).** Same 2a pattern: the dashboard counts + list reads,
  detail/revisions/compare reads, and `searchInterconnectWhereUsed` (the global where-used feed) filter
  `org_id`; writes stamp `requireRequestOrgId()`. One change to the shared `rowExists` gate scopes
  every existence check **and** the cross-domain link validation at once — a tenant can't link a
  cable/fixture/port to another org's project or part (both already scoped).
- **Proof.** `interconnect-store.test.ts` asserts a cable/fixture created under org A is invisible to
  org B's dashboard / detail / where-used, an anonymous read sees nothing, and each org resolves only
  its own records.

### Increment 2e — the remaining app domains (shipped)

- **What.** The last still-global domains gain `org_id` (migration `052`): circuit blocks (+
  `circuit_block_parts`, `circuit_block_known_risks`, `circuit_block_instantiations`),
  `evidence_attachments`, `follow_up_records`, `part_engineering_records`, `part_substitutions`,
  `project_revision_approval_gates`, `export_bundles`, and `project_document_extractions`. **After
  this, every team-data table is scoped** — only the RLS backstop and org-on-signup remain.
- **Two live leaks closed.** Most of these were already partitioned-by-association behind a now-scoped
  project or part gate, so for them 2e is `org_id` + write-hygiene. The genuine cross-tenant leaks were
  the *standalone* reads: **circuit blocks** (reusable patterns with no project/part owner — the block
  list, the existence gates that let any user open/edit/instantiate any block, and the where-used
  search surfaced every org's blocks) and the **evidence vault** (`readEvidenceAttachmentsFromDatabase`
  listed every org's unreviewed evidence). Both now filter `org_id`.
- **Store (`apps/api/src/project-memory-store.ts` + `project-document-extraction-store.ts`).** Same 2a
  pattern: the circuit-block list/detail/where-used reads, the overlap-panel block hit-count/preview,
  and the evidence vault filter `org_id`; the circuit-block existence gates are org-scoped; every
  insert stamps `requireRequestOrgId()`. Document-extraction reads stay gated by the scoped
  `projectExists` (partition-by-association); its write stamps the org.
- **Identity.** The global circuit-block `block_key` uniqueness (`uq_circuit_blocks_block_key`) becomes
  per-tenant `(org_id, block_key)`, so the same block key can exist once per team.
- **Proof.** New two-context tests in `project-memory-store.test.ts` assert a circuit block created
  under org A is invisible to org B's list / detail / where-used (and to an anonymous request), and
  that the evidence vault only ever returns the acting org's evidence.

## Later

- Increment 3: per-org invite codes/links, basic org management UI.
- Hardening tracks: per-tenant + global rate limiting / abuse controls, onboarding / first-run UX,
  ops (scheduled backup/restore, monitoring, tested upgrade path).
