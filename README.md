# EE Library

EE Library is a private engineering memory system for hardware teams.

It is meant to preserve what a team has learned about parts, BOMs, connectors, reusable circuits, evidence, approvals, and design risk over time. Public catalog data is useful input, but the durable value is the internal truth that accumulates around real engineering decisions.

The first implemented slice is a part readiness loop:

```txt
search -> import exact MPN when needed -> inspect -> trust -> export
```

The broader product direction is:

```txt
project/BOM intake -> find prior use -> assess readiness and risk -> reuse known-good evidence -> approve/export or create follow-up work
```

EE Library is not trying to replace DigiKey, Mouser, Arrow, TraceParts, SnapEDA, or other public databases. Provider data is input. Internal engineering truth is the product: where a part was used, why it was approved, which CAD files were trusted, what connector set worked, which circuit pattern was reused, and which risks are still open.

Catalog presence is not treated as success. EE Library keeps part identity, datasheet evidence, connector buildability, asset truth, approval state, provenance, and export readiness separate so uncertain metadata never looks certain.

## Product Direction

These are the high-value workflows EE Library is being shaped around. Some have working foundations today; others are planned and should not be read as fully implemented yet.

- **Project/BOM import and where-used history**: import project BOMs, remember what was used where, and make prior engineering decisions searchable.
- **Part readiness, approval, and internal reuse**: distinguish imported, reviewed, approved, reusable, and export-ready parts.
- **Evidence-based validation and asset trust**: preserve datasheets, source rows, validation results, review decisions, and file-backed CAD evidence.
- **Connector buildability and known-good connector sets**: record mates, accessories, cables, tooling, confidence warnings, and working connector combinations.
- **Reusable circuit blocks**: track proven subcircuits with parts, notes, constraints, and reuse context.
- **BOM health and risk review**: summarize lifecycle, approval, CAD/export, evidence, connector, and sourcing risk across a project.

## Who This Is For

EE Library is for hardware teams that need their own engineering memory, not just another public part lookup.

- Electrical engineers who want to know whether a part is internally trusted, approved, and ready for design reuse.
- Hardware leads who need to review BOM risk, lifecycle exposure, connector completeness, and unresolved evidence gaps.
- CAD/library owners who need asset approval, validation evidence, and verified-for-export promotion to stay separate.
- Teams that repeatedly reuse known-good connectors, circuits, and parts across projects and want those decisions preserved.
- Organizations that use public provider data as intake, but need private project history and review decisions to become the source of truth.

## What Ships Today

- `/` and `/catalog` open directly into the catalog workbench.
- `/projects` opens project memory, supports project creation, and shows persisted project/revision/BOM/usage foundations.
- Project detail pages support CSV BOM preview, column mapping, and persistence of raw/mapped BOM rows.
- Dense catalog search supports MPN, manufacturer, provider id, package, lifecycle, CAD, readiness, approval, connector, and sort filters.
- Exact no-match MPN searches show one direct "Import exact MPN" action from configured providers.
- Supported MVP import providers are `local-catalog` for deterministic development fixtures and `jlcparts` for JLCPCB/LCSC metadata.
- Part detail pages now start with an answer-first use decision, datasheet state, CAD/export state, provenance, and next action.
- A shared next-action model maps readiness issues to concrete follow-ups in catalog rows and detail pages.
- Connector buildable-set projection shows best mate, required accessories, optional accessories, cables, and confidence warnings.
- Asset truth, validation, review, and explicit verified-for-export promotion stay separate from whole-part approval.
- Admin surfaces review, promotion, failed import, validation, and issue-driven operations queues.
- `/system/health` reports API, database, storage, worker heartbeat, and async queue state.

## Planned High-Value Additions

These workflows are intentionally called out as planned additions, not current shipped behavior.

- **BOM row matching and usage creation**: match imported BOM rows to internal parts and create confirmed usage history only when evidence supports it.
- **Where-used search**: answer where a part, connector set, asset, or circuit block has appeared before.
- **Circuit blocks**: store reusable circuits with their approved parts, evidence, design notes, constraints, and known risks.
- **Evidence vault**: collect datasheets, validation reports, review notes, source snapshots, file hashes, and approval history in one auditable place.
- **BOM health dashboard**: review lifecycle, sourcing, approval, CAD/export, evidence, connector, and reuse risk across a matched project BOM.

## Near-Term Roadmap

Near-term work should turn the current part-readiness foundation into project-level memory without blurring what is already shipped.

1. Add BOM row matching that keeps unmatched, weak, and ambiguous rows separate from confirmed usage.
2. Add where-used history for parts, connector sets, assets, and eventually circuit blocks.
3. Build evidence-vault primitives for datasheets, validation reports, review notes, source snapshots, file hashes, and approvals.
4. Define reusable circuit blocks as structured engineering objects tied to parts, evidence, constraints, and project reuse.
5. Add a BOM health dashboard that summarizes approval, lifecycle, CAD/export, evidence, connector, and reuse risk.
6. Continue tightening the current search -> inspect -> trust -> export loop so part readiness remains the reliable foundation.

## What EE Library Is Not

- It is not a replacement for DigiKey, Mouser, Arrow, TraceParts, SnapEDA, or other public databases.
- It is not a live global price, stock, or compliance authority.
- It is not an automatic claim that imported provider data is approved, validated, or export-ready.
- It is not a loose notes app for circuits, connectors, and review decisions.
- It is not a production CAD generator today.
- It is not allowed to present planned matching, where-used, circuit block, evidence vault, or BOM health workflows as shipped behavior.

## Current Boundaries

- compare and tools pages are intentionally hidden until they are functional
- subcategory search facets are still planned and should not be surfaced until persisted data exists
- exact-MPN import is not broad live provider search
- imported does not mean approved, CAD-verified, or export-ready
- BOM upload/mapping exists for CSV, but matching, where-used history, circuit blocks, evidence vault, and BOM health dashboards are planned additions
- multi-provider conflict resolution, broad datasheet extraction, and production-grade automatic CAD generation remain planned work

## Monorepo Layout

- `apps/web` - Next.js engineering workspace
- `apps/api` - provider-neutral HTTP API and workflow actions
- `apps/worker` - provider adapters, ingestion, normalization, and readiness recomputation
- `packages/shared` - canonical types, readiness logic, search/runtime helpers
- `packages/db` - typed database schema
- `packages/ui` - shared UI primitives
- `infra/postgres` - incremental SQL migrations

## Docs Map

- [`REGISTER.md`](REGISTER.md) - dated git worktree and working-tree registration notes (repo root)
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) - shipped vs planned status matrix
- [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) - product intent and scope
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) - system boundaries and runtime responsibilities
- [`docs/UI_UX_BRIEF.md`](docs/UI_UX_BRIEF.md) - engineering-first UI guidance
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) - canonical entity and relationship model
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - staged delivery plan

The deeper docs describe product intent. `docs/IMPLEMENTATION_STATUS.md` tracks what is actually live in the repo today. Contract or workflow changes should update both the relevant source doc and the implementation-status matrix in the same change set.

## Local Development

```bash
npm install
npm run setup:dev
npm run dev
```

`npm run setup:dev` creates or preserves `.env`, starts local Postgres through Docker when needed, applies migrations, seeds a local admin user, imports deterministic local-catalog sample parts, and prints the login/setup summary.

For verification:

```bash
npm run typecheck
npm test
npm run smoke:local
```

Useful service-specific commands:

```bash
npm run db:status
npm run db:migrate
npm run db:reset
npm run seed:admin
npm run dev:web
npm run dev:api
npm run dev:worker
npm run ingest:local
npm run ingest:jlcparts
npm run imports:providers
npm run operations:worker
```

The web app defaults to `http://127.0.0.1:3000`; the API defaults to `http://127.0.0.1:4000`. DB-backed search and import flows require `DATABASE_URL` to point at a reachable Postgres database. If the database is unavailable, the UI stays honest and does not invent catalog records.

## First Workbench Loop

1. Open `/` or `/catalog`.
2. Paste an MPN.
3. If there is a match, scan datasheet, CAD/export, readiness, and next-action columns.
4. If an exact MPN is missing, use "Import exact MPN" from a configured provider.
5. Open the part detail page.
6. Read the use decision first, then inspect datasheet, CAD/export assets, provenance, and audit history as needed.

## Future Project Memory Loop

This is the intended project-level loop once planned project/BOM features exist:

1. Import a project BOM and preserve each original row, designator, quantity, note, and source file reference.
2. Match BOM rows to existing internal parts or create exact-MPN intake follow-up.
3. Review where each part, connector set, asset, or circuit block has been used before.
4. Check readiness, approval, validation evidence, connector buildability, CAD/export status, and lifecycle risk.
5. Reuse approved parts and circuit blocks when evidence supports it; create follow-up work when it does not.
6. Save the final decisions back into project history so the next design starts with memory instead of rediscovery.

## Product Rules

- keep `web`, `api`, and `worker` separated
- keep provider-specific logic out of UI components
- never present uncertain metadata as certain
- keep export actions tied to real file availability
- preserve provenance for normalized data and assets
- prefer deterministic names for bundles and generated or imported assets
- imported does not mean approved
- approved does not mean export-ready
- keep review approval, validation evidence, and verified-for-export promotion separate
- make project history and where-used data first-class product concepts
- treat reusable circuit blocks as engineering knowledge, not loose notes
- never hide planned work inside shipped behavior
