# EE Library — Functionality-First Prioritized TODO

**Branch**: `codex/phase-2-foundation`  
**Updated**: 2026-04-26  
**Purpose**: Shift the project from strong governance scaffolding into a usable EE part-library workflow.

---

## Current Reality

The architecture is solid, but the product still does not feel functional enough because the core user loop is not clean yet.

The next mission is not more polish, more filters, or more governance surfaces.

The next mission is:

```txt
Search MPN
→ Find exact part or import it
→ Open useful part detail
→ See datasheet/spec/package/lifecycle/source/CAD status
→ Take the next obvious action
```

Everything below is ordered to make that loop work.

---

## Recommended Next 5 Tasks

Work these in order. Do not wander into shiny UI shrubs until these are done.

1. **[P0-1] Add real local setup bootstrap**
   - Create `npm run setup:dev`.
   - It should generate/copy `.env`, create a valid `AUTH_SECRET`, start Docker services, apply migrations, seed an admin user, seed/import a few known parts, and print the app/API URLs.
   - This makes the repo usable by you, future contributors, and coding agents without tribal-memory nonsense.

2. **[P0-2] Add explicit DB migration commands**
   - Add `npm run db:migrate`, `npm run db:reset`, and optionally `npm run db:status`.
   - Docker init scripts are not enough because they only run against a fresh Postgres volume.

3. **[P0-3] Add admin bootstrap / seed script**
   - Add `npm run seed:admin` or `npm run create:admin -- --email ... --password ...`.
   - Without this, protected admin/import/review flows can feel broken immediately.

4. **[P0-4] Make exact-MPN no-match import synchronous for MVP**
   - On no match, let the user import now from a supported provider.
   - After successful import, route directly to `/parts/:partId`.
   - Do not force the user into a queued acquisition job unless the worker is visibly running.

5. **[P1-1] Rework the catalog page into a practical workbench**
   - Search bar first.
   - Results table second.
   - Import CTA only when useful.
   - Readiness/trust details only after a part is selected or matched.
   - The current page has too much cockpit energy.

---

## Completed Foundation Items

These were already completed in the prior TODO and should stay closed. They are useful, but they do not replace the need for the functionality-first work above.

- ~~Asset download/redirect endpoint~~ ✓ Done
- ~~File storage strategy and `/storage/:key` route~~ ✓ Done
- ~~JLC package dimension extraction~~ ✓ Done
- ~~Readiness recomputation confirmation and bulk recompute command~~ ✓ Done
- ~~Datasheet PDF download/hash/storage enrichment~~ ✓ Done
- ~~Catalog search page tests~~ ✓ Done
- ~~Duplicate candidate detection~~ ✓ Done
- ~~Subcategory/category filter surfacing~~ ✓ Done
- ~~Normalized JLC descriptions~~ ✓ Done
- ~~Index-friendly search SQL refactor and structural assertions~~ ✓ Done
- ~~Reject empty/weak `AUTH_SECRET`~~ ✓ Done
- ~~Migration smoke coverage for 019/020/021~~ ✓ Done
- ~~Stale homepage/admin test cleanup~~ ✓ Done
- ~~pg-mem `similarity()` shim~~ ✓ Done

---

# P0: Blocking or Mission-Critical

These directly affect whether the site feels usable and trustworthy.

---

## P0-1 · Add real local setup bootstrap

**Priority**: P0  
**Why it matters**: The current project is too easy to run in a half-broken state. A user can run the web app while Postgres, migrations, admin auth, storage, and worker flows are missing or stale. That makes the site look nonfunctional even when the architecture is good.

**Expected outcome**: A single command:

```bash
npm run setup:dev
```

does the full local setup.

**Required behavior**:
- Copy `.env.example` to `.env` if `.env` does not exist.
- Generate a 32+ byte `AUTH_SECRET` automatically if missing.
- Start Docker services with `docker compose up -d`.
- Wait for Postgres to become reachable.
- Run all migrations.
- Seed/create a local admin user.
- Seed/import several known sample parts.
- Print:
  - Web URL
  - API URL
  - Admin login
  - Useful commands for worker/import/recompute

**Files to inspect or modify**:
- `package.json`
- `scripts/`
- `.env.example`
- `compose.yaml`
- `packages/db/`
- `apps/api/`
- `apps/worker/`

**Tests**:
- Add a script test or dry-run mode if practical.
- At minimum, document a manual verification path:
  - clean clone
  - `npm install`
  - `npm run setup:dev`
  - open catalog
  - log in as admin
  - search seeded part

**Risk**: Medium. The setup touches environment, Docker, migrations, and seed data. Keep it boring and explicit.

---

## P0-2 · Add explicit DB migration commands

**Priority**: P0  
**Why it matters**: `compose.yaml` mounts SQL files into Docker entrypoint initialization. That only applies when the database volume is brand new. Once the volume exists, new migration files will not automatically apply. This is exactly how local dev environments become haunted.

**Expected outcome**:
Add commands:

```bash
npm run db:migrate
npm run db:reset
npm run db:status
```

**Required behavior**:
- `db:migrate`: applies all unapplied migrations in order.
- `db:reset`: drops/recreates local dev DB or clears schema after a confirmation/environment guard.
- `db:status`: shows current applied migration version and pending migrations.

**Files to inspect or modify**:
- `package.json`
- `packages/db/src/`
- `infra/postgres/`
- `scripts/`

**Tests**:
- Migration smoke tests already exist; add script-level coverage if practical.
- Verify migrations 001 through latest apply on an empty DB.
- Verify re-running `db:migrate` is idempotent.

**Risk**: Medium. A bad reset command can nuke data. Add explicit local/dev guardrails.

---

## P0-3 · Add admin bootstrap / seed script

**Priority**: P0  
**Why it matters**: The project has protected admin workflows, but a fresh local environment needs an obvious way to create an admin. Otherwise import/review/promote flows look broken before the product even gets judged fairly.

**Expected outcome**:
One of these commands exists:

```bash
npm run seed:admin
```

or:

```bash
npm run create:admin -- --email admin@example.com --password localdev
```

**Required behavior**:
- Create an admin user if one does not exist.
- Avoid overwriting existing users unless explicitly requested.
- Print clear login info in dev only.
- Never print production secrets.

**Files to inspect or modify**:
- `apps/web/src/auth.ts`
- `apps/web/src/app/sign-in/page.tsx`
- `packages/db/src/schema.ts`
- `scripts/`

**Tests**:
- Script creates a user row with admin privileges.
- Script is idempotent.
- Existing admin is not overwritten accidentally.

**Risk**: Low to medium. Keep it dev-safe and explicit.

---

## P0-4 · Make exact-MPN no-match import synchronous for MVP

**Priority**: P0  
**Why it matters**: The current no-match path can queue acquisition jobs and then rely on a worker process. If the worker is not running, the UI can feel like it does nothing. That is product poison.

**Expected outcome**:
For exact MPN searches:
- If catalog match exists, open/show the part.
- If no match exists, show **Import exact MPN**.
- On import click, call the direct import path.
- On success, route to `/parts/:partId`.
- On failure, show a specific provider error.

**Preferred MVP behavior**:
Use direct provider import before queued acquisition.

**Keep queued acquisition for**:
- Bulk imports.
- Scheduled sync.
- Multi-provider background enrichment.
- Cases where the worker is visibly running and job status is useful.

**Files to inspect or modify**:
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/catalog/page.tsx`
- `apps/web/src/lib/api-client.ts`
- `apps/api/src/index.ts`
- `apps/api/src/catalog-store.ts`
- `apps/worker/src/provider-acquisition-jobs.ts`

**Tests**:
- No-match exact MPN renders Import CTA.
- Clicking import calls direct import endpoint.
- Successful import redirects/links to the imported part detail.
- Failed import displays provider-specific reason.
- Generic keyword searches do not show exact-MPN import CTA.

**Risk**: Medium. Be careful not to import junk for generic searches.

---

## P0-5 · Add visible worker/status diagnostics when async jobs are used

**Priority**: P0  
**Why it matters**: If queued jobs remain in the UI, the user needs to know whether the worker is online. Polling a job that never moves makes the app look dead.

**Expected outcome**:
Add an API/worker health surface that reports:
- API reachable
- DB reachable
- storage configured
- worker recently heartbeat-ed
- pending acquisition jobs
- pending enrichment jobs
- failed jobs

**Files to inspect or modify**:
- `apps/api/src/index.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/catalog-repository.ts`
- `apps/web/src/app/catalog/page.tsx`
- `apps/web/src/app/admin/page.tsx`

**Tests**:
- Worker offline state renders a warning.
- Worker online state clears warning.
- Queued job UI includes status and next action.

**Risk**: Low. Read-only visibility. Big usability payoff.

---

# P1: Core Product Usability

These make the site feel like an actual part-library tool instead of a governance dashboard wearing boots.

---

## P1-1 · Rework catalog page into a practical workbench

**Priority**: P1  
**Why it matters**: The catalog/search page is trying to do too many jobs at once. It should be the main place engineers go to find or import a part.

**Expected outcome**:
Simplify the page into three zones:

```txt
1. Search / Import
2. Results
3. Selected part summary or next action
```

**Recommended layout**:
- Top: large search box for MPN/manufacturer/provider ID.
- Small secondary controls: filters, sort, CAD availability.
- Results table with:
  - MPN
  - manufacturer
  - description
  - package
  - lifecycle
  - datasheet status
  - CAD status
  - readiness status
- No-match state:
  - exact MPN → Import CTA
  - vague query → refine search copy
- Ambiguous state:
  - show candidate list, do not auto-pick first result.

**Files to inspect or modify**:
- `apps/web/src/app/catalog/page.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/lib/detail-view-model.ts`

**Tests**:
- Ready state with DB results.
- No-match exact MPN shows import.
- No-match vague query does not show import.
- Ambiguous result shows candidates.
- Result row links to part detail.

**Risk**: Medium. UI refactor can break existing tests. Keep components small.

---

## P1-2 · Make part detail page engineer-first

**Priority**: P1  
**Why it matters**: The detail page should answer the engineer's question fast: "Can I use this part, and what do I know about it?"

**Expected outcome**:
At the top of `/parts/:partId`, show:

- MPN
- manufacturer
- normalized description
- package
- lifecycle
- datasheet link/download
- key metrics/specs
- CAD availability
- source/provider provenance
- readiness status
- next recommended action

**Recommended section order**:
1. Identity summary
2. Critical engineering data
3. Datasheet and assets
4. CAD/export status
5. Provider/source provenance
6. Readiness issues and admin actions
7. Raw/debug details collapsed by default

**Files to inspect or modify**:
- `apps/web/src/app/parts/[partId]/page.tsx`
- `apps/web/src/lib/detail-view-model.ts`
- `packages/shared/src/types.ts`

**Tests**:
- Detail page renders datasheet link when available.
- Detail page renders CAD missing vs verified state.
- Detail page renders source/provider provenance.
- Detail page renders key metrics/specs in a scannable table.

**Risk**: Low to medium. Mostly presentation logic.

---

## P1-3 · Link readiness issues to actionable workflows

**Priority**: P1  
**Why it matters**: Showing `missing_verified_cad` or `pending_approval` without a direct next action wastes the operator's time.

**Expected outcome**:
Each issue on the part detail page gets a contextual action:
- `missing_verified_cad` → request/generate CAD asset
- `pending_approval` → open approval/review queue
- `missing_datasheet` → run/import datasheet enrichment
- `duplicate_candidate` → open duplicate/reconciliation workflow
- `source_conflict` → open source reconciliation
- connector issues → open connector intelligence workflow or mark unsupported

**Files to inspect or modify**:
- `apps/web/src/app/parts/[partId]/page.tsx`
- `apps/web/src/lib/detail-view-model.ts`
- `apps/web/src/app/admin/page.tsx`

**Tests**:
- Helper covers every issue code.
- Detail page renders expected action link for each issue type.

**Risk**: Low. Mostly UI routing.

---

## P1-4 · Add a true end-to-end happy-path test

**Priority**: P1  
**Why it matters**: Unit tests are strong, but the product needs a locked-down user loop. Without this, the site can pass tests while still feeling useless.

**Expected outcome**:
Add one integration/e2e-style test that covers:

```txt
search unknown exact MPN
→ import from supported provider/local fixture
→ part is created
→ part detail opens
→ datasheet/source/readiness surfaces render
```

**Possible implementation options**:
- Playwright test against local dev services.
- API integration test plus web render test.
- Test fixture provider if real provider calls are too brittle.

**Files to inspect or modify**:
- `apps/web/`
- `apps/api/`
- `apps/worker/`
- `tests/` or package-level test setup

**Risk**: Medium. E2E tests can be flaky. Use local fixture provider first.

---

## P1-5 · Make product copy honest about provider coverage

**Priority**: P1  
**Why it matters**: The app should not imply it can fetch "any part out there" when current coverage is limited.

**Expected outcome**:
Update copy to say:
- "Search your catalog or import exact MPNs from configured providers."
- "Supported providers: Local Catalog, JLC/LCSC mirror."
- "More distributors can be added through provider adapters."

**Files to inspect or modify**:
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/catalog/page.tsx`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/IMPLEMENTATION_STATUS.md`

**Tests**:
- Update stale copy assertions if needed.

**Risk**: Low.

---

## P1-6 · Add local fixture provider for reliable development/demo imports

**Priority**: P1  
**Why it matters**: JLC/LCSC/community mirror behavior can change or fail. A local fixture provider gives the app a reliable "it works" demo path and stable tests.

**Expected outcome**:
A provider like `fixture-provider` or `demo-catalog` supports a few canonical parts:
- resistor
- capacitor
- voltage regulator
- connector
- microcontroller or IC

Each fixture should include:
- manufacturer
- MPN
- package
- category
- lifecycle
- metrics/specs
- datasheet URL or local file
- CAD readiness states, at least one missing and one verified/demo

**Files to inspect or modify**:
- `apps/worker/src/providers/`
- `apps/api/src/provider-lookup*`
- `apps/worker/src/provider-acquisition-jobs.ts`
- `packages/shared/src/types.ts`

**Tests**:
- Import each fixture by exact MPN.
- Search each imported fixture.
- Detail page renders useful fields.

**Risk**: Low. Demo data must be clearly labeled.

---

# P2: Important but Not Immediate

## P2-1 · Add extraction signal review UI to admin page

**Priority**: P2  
**Why it matters**: Extraction signals exist, but operators need a queue to review them and trigger downstream generation.

**Expected outcome**:
Add an "Extraction Signals" admin section grouped by signal type:
- part MPN
- signal type
- confidence
- source
- review action
- optional generation trigger

**Files to inspect or modify**:
- `apps/web/src/app/admin/page.tsx`
- `apps/api/src/catalog-store.ts`
- `apps/api/src/index.ts`

**Tests**:
- Admin page renders extraction signal queue.
- API returns grouped extraction signals.

**Risk**: Low.

---

## P2-2 · Verify issue generation coverage for every readiness issue code

**Priority**: P2  
**Why it matters**: Every issue code should have at least one test path from input state to rendered/admin-visible issue.

**Expected outcome**:
A test matrix covers:
- `low_confidence_identity`
- `pending_approval`
- `missing_verified_cad`
- `missing_datasheet`
- `missing_connector_mate`
- `missing_connector_accessories`
- `connector_low_confidence`
- `lifecycle_risk`
- `source_conflict`
- `duplicate_candidate`

**Files to inspect or modify**:
- `packages/shared/src/part-readiness.ts`
- `apps/worker/src/catalog-repository.test.ts`
- `apps/web/src/app/admin/page.test.ts`

**Risk**: Low.

---

## P2-3 · Auto-detect multi-provider source conflicts

**Priority**: P2  
**Why it matters**: As soon as more providers exist, conflicting normalized data becomes a real data-integrity problem.

**Expected outcome**:
After successful import, compare source records for the same `part_id` across providers. If key fields disagree, create:
- `source_conflict` issue
- pending `part_source_reconciliations` row

**Fields to compare first**:
- manufacturer
- package
- category
- lifecycle status
- datasheet URL

**Files to inspect or modify**:
- `apps/worker/src/provider-acquisition-jobs.ts`
- `apps/worker/src/catalog-repository.ts`
- `packages/shared/src/part-readiness.ts`

**Risk**: Medium. Avoid noisy false positives.

---

## P2-4 · Add lifecycle and connector-class facet counts

**Priority**: P2  
**Why it matters**: Engineers benefit from seeing counts in filters, especially lifecycle states.

**Expected outcome**:
`readSearchFacets()` returns counts for:
- lifecycle status
- connector class

Catalog filter UI renders counts.

**Files to inspect or modify**:
- `apps/api/src/catalog-store.ts`
- `packages/shared/src/types.ts`
- `apps/web/src/app/catalog/page.tsx`

**Risk**: Low.

---

## P2-5 · Add compare page

**Priority**: P2  
**Why it matters**: Engineers often compare drop-in candidates. This becomes more valuable once the search/import/detail loop is good.

**Expected outcome**:
`GET /compare?parts=id1,id2,id3` renders comparison for up to 4 parts:
- MPN
- manufacturer
- package
- lifecycle
- metrics/specs
- datasheet
- CAD readiness
- source/provider

**Files to inspect or modify**:
- `apps/web/src/app/compare/page.tsx`
- `apps/web/src/components/AppNavigation.tsx`

**Risk**: Low.

---

## P2-6 · Add API rate limiting

**Priority**: P2  
**Why it matters**: Search endpoints can be hammered. Even indexed queries cost resources.

**Expected outcome**:
In-memory rate limiter:
- search: about 60/min/IP
- detail reads: about 120/min/IP
- writes/imports: about 10/min/IP

Return `429` with `Retry-After`.

**Files to inspect or modify**:
- `apps/api/src/index.ts`

**Risk**: Low.

---

# P3: Future / Polish / Scale

## P3-1 · Draft generation: handle unsupported 3D model requests honestly

**Priority**: P3  
**Expected outcome**:
Either implement a minimal stub path or return `not_requestable` with reason `3d_model_generation_not_yet_supported`.

---

## P3-2 · Automated file integrity validation after download

**Priority**: P3  
**Expected outcome**:
After download, verify hash, check PDF header for datasheets, write `asset_validation_records`, and update asset validation status.

---

## P3-3 · Role-based access beyond single admin flag

**Priority**: P3  
**Expected roles**:
- `reader`
- `reviewer`
- `admin`

---

## P3-4 · Generic audit log for all mutating actions

**Priority**: P3  
**Expected outcome**:
Add `catalog_audit_events` and log imports, issue workflow changes, source reconciliation, generation requests, promotions, and reviews.

---

## P3-5 · Scheduled JLC/LCSC catalog sync

**Priority**: P3  
**Expected outcome**:
Worker command:

```bash
npm run sync:jlcparts
```

---

## P3-6 · Manufacturer alias normalization

**Priority**: P3  
**Expected outcome**:
Before creating a manufacturer, check exact normalized name and exact alias match. Do not do fuzzy merges yet.

---

## P3-7 · Improve operations worker diagnostics

**Priority**: P3  
**Expected outcome**:
`npm run operations:worker` reports acquisition jobs, enrichment jobs, stale readiness summaries, stuck assets, extraction signals, failed jobs, and parts without acquisition history.

---

# Explicit Non-Goals Until P0/P1 Are Done

Do not spend meaningful time on these yet:

- More landing-page polish
- More marketing copy beyond provider honesty
- More decorative UI
- More filters beyond practical catalog work
- Compare page before import/detail loop works
- Advanced connector intelligence expansion
- Real 3D generation
- Large provider ecosystem design

First, make the tool feel useful.

---

# Success Criteria for the Next Milestone

The next milestone is successful when a clean local environment can do this without hand-holding:

```txt
1. Run one setup command.
2. Open the app.
3. Log in as admin.
4. Search for a known exact MPN.
5. If missing, import it immediately.
6. Land on the part detail page.
7. See datasheet/spec/package/lifecycle/source/CAD/readiness.
8. Know the next action if data is missing.
```

If the product cannot do that smoothly, the rest is fancy wiring in a truck with no tires.
