# EE Library - Engineering Memory TODO

**Updated**: 2026-04-30
**Working branch**: `codex/fix-catalog-repository-typecheck`
**Purpose**: Turn the shipped part-readiness foundation into a private engineering memory system for hardware teams.

---

## Current Reality

The project has successfully moved past "can the stack run?" and most of the first usability rescue.

What is actually shipped today:

- `/` and `/catalog` open into the catalog workbench.
- Exact-MPN no-match searches can import from configured providers.
- Search results expose datasheet, CAD/export, readiness, and next action.
- Part detail pages have an answer-first use decision.
- Connector buildable-set logic exists.
- Asset truth, validation evidence, review, and verified-for-export promotion are separate.
- Admin surfaces exist for review, promotion, failed import, validation, and issue-driven operations queues.
- Setup, migration, seed-admin, health, worker diagnostics, typecheck, and tests are in good shape.
- Project/BOM memory persistence, read-only API foundations, `/projects` dashboard/detail skeletons, project creation, and CSV BOM upload/mapping now exist for persisted DB-backed records.

What is **not** shipped yet:

- Project editing UI.
- BOM row part matching.
- Part-to-project usage history.
- Where-used search.
- Circuit block records.
- Broad evidence vault.
- BOM health dashboard.

That means the TODO needs to pivot. The part-readiness loop remains the foundation, but the next major product mission is now:

```txt
project/BOM intake
-> preserve original row context
-> match rows to internal parts
-> create usage history
-> review BOM health and risks
-> make reuse decisions evidence-backed
```

Provider data remains input. Internal engineering truth is the product.

---

## Project Review Findings

- The docs now describe Project, ProjectRevision, BomImport, BomLine, ProjectPartUsage, CircuitBlock, CircuitBlockPart, EvidenceAttachment, and RiskFinding as planned/future concepts.
- Code now has a shipped project/BOM memory foundation for persisted project records, revisions, BOM imports, BOM lines, confirmed usage reads, project creation, and CSV BOM upload/mapping.
- No shipped automatic matching, where-used search, circuit-block implementation, evidence vault UI, or BOM health dashboard exists yet.
- Existing readiness, approval, asset, connector, validation, and risk projection code can support BOM health later.
- Existing migration and test infrastructure is ready for a careful schema-first implementation.
- The old TODO still prioritized usability cleanup and compare/BOM as P1. That is now stale: project/BOM memory should become the next P0 product direction.

---

## Recommended Next Tasks

Work these in order. Keep each task honest about planned vs shipped behavior.

1. **[P0-MEM1] Add project/BOM memory schema foundation - done 2026-04-30**
   - Create migrations for `projects`, `project_revisions`, `bom_imports`, `bom_lines`, and `project_part_usages`.
   - Preserve original BOM row payloads and weak/ambiguous match states.
   - Do not add UI claims beyond empty/foundation states.

2. **[P0-MEM2] Add shared contracts and API foundations - done 2026-04-30**
   - Build API request/response contracts around the new project, revision, BOM import, BOM line, usage, and match-status primitives.
   - Add API contracts for project list/detail, BOM import metadata, BOM lines, and usage reads.
   - Keep write paths minimal until matching/import behavior is tested.

3. **[P0-MEM3] Build project dashboard and project detail skeletons - done 2026-04-30**
   - Add planned-but-real project surfaces with honest empty states.
   - Show project/revision/BOM concepts without pretending BOM import is complete.
   - Keep navigation clear that project memory is a new area, not public catalog search.

4. **[P0-MEM4] Build BOM upload and column-mapping MVP - done 2026-04-30**
   - Support CSV first unless an existing library makes XLSX low-risk.
   - Let users map MPN, manufacturer, quantity, designators, description, notes, and supplier references.
   - Store raw rows and mapped fields before part matching.

5. **[P0-MEM5] Add BOM row part matching and usage creation - next**
   - Match exact internal MPN/manufacturer first.
   - Mark rows as matched, unmatched, ambiguous, or weak.
   - Create `ProjectPartUsage` only for confirmed matches.
   - Route unmatched exact MPNs toward the existing exact import path.

6. **[P0-MEM6] Add where-used foundation**
   - Show where a part is used by project, revision, designator, quantity, and usage status.
   - Start with part detail and a simple where-used route.
   - Do not imply historical usage means approved reuse.

7. **[P0-MEM7] Add BOM health and risk projection MVP**
   - Derive counts for matched/unmatched/ambiguous rows, approval gaps, lifecycle risk, missing verified CAD/export assets, connector buildability gaps, and missing evidence.
   - Store or expose RiskFinding-style records only when they are explainable.
   - Render a project/BOM health dashboard with next actions.

8. **[P0-MEM8] Add evidence attachment foundation**
   - Attach evidence to parts, assets, projects, BOM imports/lines, usage records, and risk findings.
   - Keep evidence separate from validation, approval, and export readiness.
   - Start with metadata and local storage references before building a broad evidence vault UI.

9. **[P0-MEM9] Add circuit block records**
   - Add CircuitBlock and CircuitBlockPart data model.
   - Build a simple circuit block library and detail view.
   - Treat blocks as structured engineering knowledge with parts, constraints, evidence, risk, and reuse scope.

---

# P0: Project/BOM Memory Foundation

These are the new blocking product tasks because the mission has expanded from a part workbench to engineering memory.

---

## P0-MEM1 - Add Project/BOM Memory Schema Foundation

**Priority**: P0
**Status**: Done 2026-04-30. Added migration `024_project_bom_memory.sql`, Drizzle schema mappings, shared planned-memory types, migration discovery coverage, and pg-mem smoke coverage for raw BOM rows, weak matches, confirmed usage, and idempotency guards.

**Why it matters**: Project memory cannot be built on loose notes or UI-only state. The database needs first-class project, revision, BOM import, BOM line, and usage records before any honest where-used or BOM health workflow can exist.

**Expected outcome**:

- New migrations add:
  - `projects`
  - `project_revisions`
  - `bom_imports`
  - `bom_lines`
  - `project_part_usages`
- BOM rows preserve raw source payloads.
- BOM line match status supports `unmatched`, `matched`, `ambiguous`, `weak_match`, and `ignored`.
- Usage records link confirmed parts to projects/revisions/BOM rows.

**Files to inspect or modify**:

- `infra/postgres/`
- `packages/db/src/schema.ts`
- `packages/shared/src/`
- `scripts/__tests__/migrations.test.mjs`
- `apps/api/src/migration-smoke.test.ts`

**Tests**:

- Migration applies to empty DB.
- Migration stays idempotent where applicable.
- Schema exposes typed tables.
- Weak/ambiguous match statuses are represented without pretending a part was confirmed.

**Done when**:

- The repo can persist project/BOM memory primitives without adding UI claims.

**Completion notes**:

- Created first-class project, revision, BOM import, BOM line, and confirmed usage persistence.
- Preserved raw BOM row payloads and explicit match status so weak/ambiguous rows do not become where-used history.
- Added typed foundations only; project/BOM UI and API workflow claims remain planned under later P0-MEM tasks.

---

## P0-MEM2 - Add Shared Contracts And API Foundations

**Priority**: P0
**Status**: Done 2026-04-30. Added project-memory API response contracts, read-only project/BOM/usage store functions, HTTP read routes, and focused API coverage for empty, unavailable, not-found, planned-capability, BOM-line, and confirmed-usage states.

**Why it matters**: The UI, API, and worker need shared language before BOM upload, matching, usage history, and BOM health can be built safely.

**Expected outcome**:

- API request/response contracts for project, revision, BOM import, BOM line, usage, match status, and import status.
- API read endpoints for:
  - project list
  - project detail
  - project revisions
  - BOM imports
  - BOM lines
  - part usage by project
- API responses distinguish empty, unavailable, not configured, and planned/future states.

**Files to inspect or modify**:

- `packages/shared/src/`
- `apps/api/src/`
- `apps/api/src/index.ts`
- `apps/api/src/catalog-store.ts` or a new project store module
- `apps/web/src/lib/`

**Tests**:

- API returns empty project list from configured empty DB.
- API returns DB-not-configured state honestly.
- Types prevent weak matches from appearing as confirmed usage.

**Done when**:

- Project/BOM memory has provider-neutral API contracts, even before full upload/matching UI.

**Completion notes**:

- Added typed responses for project list/detail, project revisions, project BOM imports, BOM import lines, and project part usages.
- Added read-only API routes without creating BOM upload, matching, where-used UI, circuit block, evidence vault, or BOM health claims.
- Confirmed weak BOM lines remain line evidence only and do not become confirmed usage records.

---

## P0-MEM3 - Build Project Dashboard And Detail Skeletons

**Priority**: P0
**Status**: Done 2026-04-30. Added `/projects` and `/projects/[projectId]` read-only project memory surfaces, navigation, API client helpers, setup/empty states, capability separation, and focused web tests.

**Why it matters**: The app needs a visible project-memory home, but it must not overclaim unimplemented BOM workflows.

**Expected outcome**:

- Navigation includes Projects.
- Projects dashboard shows project list, empty state, and setup guidance.
- Project detail shows revisions, BOM imports, usage summary, and risk/health placeholders only where backed by data.
- Empty states explain what is not implemented yet without marketing copy.

**Files to inspect or modify**:

- `apps/web/src/app/projects/`
- `apps/web/src/components/AppNavigation.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/globals.css`

**Tests**:

- Projects dashboard renders empty DB state.
- Project detail renders not-found and empty states.
- Navigation does not imply BOM health is shipped before data exists.

**Done when**:

- Users can see project memory as a real area of the product without confusing it for completed BOM import.

**Completion notes**:

- Added Projects navigation and updated shell framing around engineering memory.
- Added a project dashboard that reads persisted project summaries, shows setup guidance, and keeps BOM upload, matching, where-used, circuit blocks, and BOM health labeled as planned.
- Added a project detail skeleton with project summary, revisions, BOM imports, confirmed usage, and a planned BOM health placeholder without inventing risk counts.
- Added web coverage for empty DB state, setup state, persisted project rows, project detail child sections, and 404 handling.

---

## P0-MEM4 - Build BOM Upload And Column-Mapping MVP

**Priority**: P0
**Status**: Done 2026-04-30. Added project creation, CSV BOM preview, mapping, API-backed persistence, project detail upload UI, bounded previews, and regression coverage for parser, API write routes, and web rendering.

**Why it matters**: BOM import is the bridge from part readiness to project memory.

**Expected outcome**:

- Upload CSV BOM.
- Preview rows.
- Map columns for MPN, manufacturer, quantity, designators, description, notes, and supplier references.
- Persist `BomImport` and `BomLine` rows.
- Preserve raw row payloads.

**Files to inspect or modify**:

- `apps/web/src/app/projects/[projectId]/`
- `apps/api/src/`
- `apps/worker/src/`
- `packages/shared/src/`
- `infra/postgres/`

**Tests**:

- CSV parsing handles headers, blanks, and repeated designators.
- Mapping preview does not create parts.
- Persisted lines keep raw and mapped values.
- Bad files fail with clear errors.

**Done when**:

- A user can upload a BOM and store mapped rows without any fake match or readiness claims.

**Completion notes**:

- Added project creation from `/projects`, including first draft revision creation so BOM intake has a real project scope.
- Added CSV BOM preview and column mapping on project detail pages for MPN, manufacturer, quantity, designators, description, notes, and supplier references.
- Added API write routes for project creation, no-write BOM preview, and mapped BOM persistence.
- Persisted `BomImport` and `BomLine` records with raw row payloads, parsed designators/quantity, and `unmatched` status; no parts or usage records are created by upload.
- Added bounded previews and row limits so large files do not force the project detail page to render every line.

---

## P0-MEM5 - Add BOM Row Matching And Usage Creation

**Priority**: P0

**Why it matters**: Where-used and BOM health require confirmed usage records, not guessed matches.

**Expected outcome**:

- Exact MPN/manufacturer match against internal catalog.
- Ambiguous rows stay ambiguous.
- Weak rows stay weak.
- Confirmed matches create `ProjectPartUsage`.
- Unmatched exact MPN rows can link to the existing exact import flow.

**Files to inspect or modify**:

- `apps/worker/src/`
- `apps/api/src/`
- `packages/shared/src/search.ts`
- `apps/web/src/components/ImportByMpnPanel.tsx`

**Tests**:

- Exact match creates usage.
- Ambiguous match does not create usage.
- Weak match does not create usage.
- Existing import flow can be reached from unmatched exact rows.

**Done when**:

- Internal part usage history starts from confirmed evidence, not convenience guesses.

---

## P0-MEM6 - Add Where-Used Foundation

**Priority**: P0

**Why it matters**: Where-used history is the first visible payoff of project memory.

**Expected outcome**:

- Part detail shows project usage when records exist.
- Dedicated where-used route or panel shows project, revision, usage status, designators, and quantity.
- Usage context stays distinct from approval and export readiness.

**Files to inspect or modify**:

- `apps/web/src/app/parts/[partId]/page.tsx`
- `apps/web/src/app/projects/`
- `apps/api/src/`
- `packages/shared/src/`

**Tests**:

- Part with no usage shows honest empty state.
- Part with usage shows project/revision/designator/quantity.
- Usage does not change approval/export labels.

**Done when**:

- A user can answer "where have we used this before?" for confirmed usage records.

---

## P0-MEM7 - Add BOM Health And Risk Projection MVP

**Priority**: P0

**Why it matters**: BOM health turns project memory into decision support for hardware leads.

**Expected outcome**:

- BOM summary reports:
  - matched rows
  - unmatched rows
  - ambiguous/weak rows
  - approval gaps
  - lifecycle risk
  - missing verified CAD/export assets
  - connector buildability gaps
  - missing evidence
- Risk findings include clear next actions.
- Dashboard avoids opaque scores unless each score has explainable inputs.

**Files to inspect or modify**:

- `packages/shared/src/`
- `apps/api/src/`
- `apps/worker/src/`
- `apps/web/src/app/projects/[projectId]/`

**Tests**:

- BOM health derives expected counts from fixture rows.
- Missing verified CAD is not confused with missing referenced CAD.
- Approved does not imply export-ready.
- Risk findings remain explainable.

**Done when**:

- A project BOM can be reviewed for concrete readiness and risk gaps.

---

## P0-MEM8 - Add Evidence Attachment Foundation

**Priority**: P0

**Why it matters**: Internal engineering truth needs evidence beyond provider rows and asset validation records.

**Expected outcome**:

- Evidence attachments can reference parts, assets, projects, BOM imports, BOM lines, usage records, and risk findings.
- Attachments preserve provenance, file/link state, review status, and storage metadata.
- Evidence does not imply validation, approval, or export readiness by itself.

**Files to inspect or modify**:

- `infra/postgres/`
- `packages/shared/src/`
- `apps/api/src/`
- `apps/web/src/`
- storage helpers if files are supported in the first pass

**Tests**:

- Evidence metadata persists.
- Evidence can attach to multiple supported target types.
- Evidence state does not alter part approval/export readiness.

**Done when**:

- The project can preserve decision evidence without overclaiming trust.

---

## P0-MEM9 - Add Circuit Block Records

**Priority**: P0

**Why it matters**: Reusable circuits are one of the strongest forms of internal engineering memory. They must be structured objects, not loose notes.

**Expected outcome**:

- CircuitBlock and CircuitBlockPart persistence.
- Circuit block list and detail views.
- Required/optional parts, constraints, status, evidence links, risks, and reuse scope.
- Part detail can eventually show circuit block usage.

**Files to inspect or modify**:

- `infra/postgres/`
- `packages/shared/src/`
- `apps/api/src/`
- `apps/web/src/app/circuit-blocks/`

**Tests**:

- Circuit block can be created/read from API.
- Required parts render distinctly from optional parts.
- Circuit block status does not override part readiness.

**Done when**:

- Reusable circuit knowledge has a durable, queryable structure.

---

# Carry-Forward Workbench Polish

These remain useful, but they are no longer the main P0 mission unless they block project-memory workflows.

## UX-CF1 - Split Catalog Page Into Components

The catalog page is still too large. Extract search form, filter bar, quick readiness result, no-match/import state, and results presentation.

## UX-CF2 - Split Detail Page Into Components

The detail page remains too large. Extract use decision, readiness summary, asset summary, connector summary, provenance/audit sections, and action rail.

## UX-CF3 - Continue Visual-Density Cleanup

Keep tightening shell/catalog/detail density as project screens are added. Avoid returning to card-heavy or marketing-style layouts.

## UX-CF4 - Rework Admin Into Task Queues

Admin should continue moving toward queue-based operations with counts, filters, and concrete actions.

## UX-CF5 - Improve Local Fixtures

Add a stronger fixture set for project/BOM testing: resistor, capacitor, regulator, connector set, microcontroller, known missing CAD, known verified CAD, and known lifecycle risk.

---

# Completed Foundation

These are complete and should remain regression-covered:

- Real local setup bootstrap.
- Explicit DB migration/reset/status commands.
- Admin bootstrap seed script.
- Direct exact-MPN no-match import for MVP.
- Worker/status/queue diagnostics.
- `/` renders the catalog workbench.
- Catalog dense results table.
- Detail use-decision card.
- Shared next-action model.
- First visual-density reset.
- Happy-path product loop test.
- Asset download/redirect endpoint.
- Local file storage and `/storage/:key`.
- JLC package dimension extraction.
- Readiness recomputation command.
- Datasheet download/hash/storage enrichment.
- Catalog search tests and index-friendly SQL.
- Duplicate candidate detection.
- Category/subcategory/facet surfacing.
- Auth-secret validation.
- Migration smoke coverage.
- Project/BOM memory schema foundation.
- Project/BOM memory read contracts and API foundations.
- Project dashboard and project detail skeletons with honest planned-work states.
- Project creation and CSV BOM upload/column mapping foundation.

---

# Execution Plan

## Phase 1 - Memory Schema And Contracts

Implement **P0-MEM1** and **P0-MEM2** together.

Goal: project/BOM memory has durable persistence and typed API/shared contracts before UI claims exist.

Verification:

```bash
npm run typecheck
npm test
```

## Phase 2 - Project Shell And BOM Intake

P0-MEM4 is complete on top of the completed **P0-MEM3** project shell.

Goal met: users can store mapped BOM rows from a project detail surface without part matching overclaims.

Verification:

```bash
npm run typecheck
npm test -w @ee-library/web
npm test -w @ee-library/api
```

## Phase 3 - Usage And Where-Used

Implement **P0-MEM5** and **P0-MEM6** together.

Goal: confirmed BOM matches create usage history, and users can answer where a part has been used.

Verification:

```bash
npm run typecheck
npm test
```

## Phase 4 - BOM Health, Evidence, And Circuit Blocks

Implement **P0-MEM7**, **P0-MEM8**, and **P0-MEM9** after usage history exists.

Goal: project memory becomes actionable through risk review, evidence, and structured circuit reuse.

Verification:

```bash
npm run typecheck
npm test
npm run smoke:local
```

---

# Non-Goals For The Next P0 Wave

- Do not build live distributor search as a substitute for internal project memory.
- Do not present project/BOM, where-used, circuit block, evidence vault, or BOM health workflows as shipped until implemented.
- Do not let BOM import silently create approved parts.
- Do not let weak BOM matching create confirmed usage.
- Do not let evidence attachments imply validation, approval, or export readiness.
- Do not build compare/tools before project memory has a usable foundation.
- Do not pursue broad provider ecosystem work before project/BOM memory can preserve internal decisions.

First, make the product remember projects.
