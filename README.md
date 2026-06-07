# EE Library

EE Library helps hardware teams reuse trusted parts, review BOM risk, validate CAD readiness, and preserve the engineering decisions that usually disappear into old projects, emails, spreadsheets, and tribal knowledge.

It is a private engineering memory system, not a public component search clone. Public catalog data from providers is useful input, but the durable value is the internal truth that accumulates around real designs: where a part was used, why it was approved, which CAD files were trusted, what connector set worked, which circuit pattern was reused, and which risks remain open.

EE Library is not trying to replace DigiKey, Mouser, Arrow, TraceParts, SnapEDA, or other public databases. Those tools help find parts. EE Library helps a team decide whether a part is trusted, reusable, approved, risky, blocked, or ready for export.

## Public Component Truth vs. Private Engineering Truth

A public aggregator (Octopart/Nexar, DigiKey, Mouser, …) knows the world's public component truth. EE Library knows your team's private engineering truth. That is the difference, and it is a big one.

A public component database answers:

- What is this part?
- Who sells it?
- Is it in stock?
- What is the lifecycle?
- What datasheet/CAD model exists?
- What are the parametrics?
- Is there compliance data?

EE Library answers the questions only your own history can answer:

- Have we used this before?
- Where did we use it?
- Did it work, or did it bite us?
- Which engineer approved it?
- Which footprint did we trust?
- Which datasheet revision did we design from?
- Which connector actually mated correctly in the real harness?
- Which CAD model was verified against the physical part?
- Which test fixture, board, cable, or program depended on it?
- What tribal memory exists around this part?
- What past mistake are we about to repeat?

Public data is intake. The durable product is the private engineering truth that accumulates around real designs. Because that truth is the point — not raw catalog breadth — EE Library treats public providers as interchangeable, prefers free/distributor sources (JLC/LCSC, DigiKey, Mouser, a local KiCad CAD index), and keeps the paid Octopart/Nexar aggregator strictly optional and opt-in.

## Problems It Solves

EE Library is built to answer practical engineering questions:

- Have we used this part before?
- Is this part approved for new designs?
- Can we trust the datasheet source, symbol, footprint, 3D model, and pin mapping?
- Is this BOM carrying lifecycle, sourcing, CAD, approval, connector, or evidence risk?
- What connector mates, contacts, backshells, cables, and tooling are required?
- Which parts, circuits, and connector sets are known-good for reuse?
- Why was this part selected, restricted, substituted, or blocked?

Catalog presence is not treated as success. EE Library keeps part identity, datasheet evidence, connector buildability, asset truth, approval state, provenance, and export readiness separate so uncertain metadata never looks certain.

## Core Workflows

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

These are the high-value workflows EE Library is built around. Most have **shipped** foundations today—see [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for exact boundaries. Basic **`/compare`** is shipped; **deeper compare** (connector/CAD-first matrices) and **calculators** remain planned until listed there.

- **Find prior use before choosing a part**
- **Separate imported data from reviewed, approved, and export-ready truth**
- **Validate CAD assets with evidence instead of assuming availability means trust**
- **Confirm connector buildability before procurement orders half a connector set**
- **Reuse proven circuit blocks with context, constraints, and known risks**
- **Review BOM health before lifecycle, sourcing, CAD, or approval gaps become schedule problems**

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

## Problems It Solves

- “Have we used this part before?”
- “Is this part approved for new designs?”
- “Can I trust the footprint, symbol, 3D model, and datasheet source?”
- “Which BOM lines are obsolete, risky, unapproved, or missing evidence?”
- “What connector mates, contacts, backshells, cables, and tooling are required?”
- “Why was this part selected, blocked, replaced, or restricted?”


## Current Capabilities

**Catalog and parts**

- `/` and `/catalog` open into the dense catalog workbench (filters: readiness, approval, CAD, lifecycle, connector class, sort, etc.).
- Exact no-match MPN searches first run an explicit provider lookup, then import the selected exact candidate from configured providers. Free sources are `jlcparts`, `digikey`, `mouser`, the local `kicad` CAD index, and `local-catalog`; `octopart` (Octopart via the paid Nexar API) is optional and only active when Nexar credentials are configured.
- Part detail is answer-first: use decision, datasheet and CAD/export state, connector buildable set, provenance, approved substitutes, next actions.
- Part detail can show source-linked **supply offer snapshots** when persisted (`supply_offerings` / `price_breaks`), with supplier identity where captured, freshness warnings, stale refresh scheduling, retired-row handling, and no live-stock claim.
- Asset truth, validation, review, and verified-for-export promotion stay separate from whole-part approval.
- **File-grounded asset validators** (worker jobs): footprint geometry sanity (pad count vs pin count, body bounding box) and symbol pin-count cross-check against high-confidence datasheet extraction. Results write `asset_validation_records` with `provenance = 'generated'`; validators never auto-promote `validation_status`, `review_status`, or `export_status`. Part detail surfaces plain trust-check badges in the files area, and `/admin` has a CAD trust-check worklist for failed or review-required checks.

**Project and BOM memory**

- `/projects`: create projects and revisions, CSV and **XLSX** BOM preview, column mapping, persisted raw/mapped BOM rows.
- **Row matching** creates confirmed `project_part_usages` only when deterministic internal identity matches; weak/unmatched rows stay distinct.
- **Day-zero overlap panel** on project detail ranks prior projects by shared *confirmed-usage* parts, shows prior usage clues (revision, designators, quantity, status), and previews reusable circuit-block roles hit by this BOM. Overlap is a reuse signal, never an approval signal.
- BOM **health/diagnostics**, **fleet risk** on the dashboard, **revision compare**, **follow-ups**, **lifecycle regression** findings, **substitution** hints, **approval batch** from project context, and **export bundle** history with downloads when file-backed keys exist.

**Engineering workspaces**

- **`/compare`** — up to four parts from Catalog/detail actions or the in-page selection tray: key metrics, lifecycle, trust, readiness, approval, asset-class readiness, trust-stage diff, **side-by-side CAD preview band** (Symbol / Footprint / 3D model using the shared honesty matrix), connector context, and export bundle gate in one table.
- **Asset PDF/image/3D preview** on part detail — when a stored PDF or supported image is `previewStatus: ready`, an inline preview appears; when a stored STEP (or other source 3D format) has a worker-generated viewer-only glTF/glb artifact, an inline lazy-loaded `<model-viewer>` is shown. The derived 3D preview never promotes the source asset's validation, approval, or export state. Reference-only files stay download / open in new tab only.
- `/where-used` across parts, circuit blocks, connector sets (mates), and assets (bundle manifests).
- `/evidence` vault with filters, review, and storage-backed attachments tied to projects, BOM lines, parts, findings, and blocks.
- `/circuit-blocks` library and detail: part roles, reuse signals, instantiation into a project BOM.
- `/connector-sets`: browse connector families, mate pairs, and project usage counts.
- `/vendors`: filesystem-backed supplier notebook for PCB shops, sheet metal, machining, finishing, and assembly partners — notes and reference files per vendor, reachable even when the database is down.
- `/admin` queues; `/system` health workspace for API, DB, storage, worker, and queue recovery; authenticated shell via `/sign-in` with self-service `/sign-up` for local workstation accounts; raw API health remains available at `/system/health`.

Authoritative detail lives in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). User-facing copy follows [`docs/COPY_GLOSSARY.md`](docs/COPY_GLOSSARY.md) — review every PR diff against it before merging.

## Still Planned (not shipped)

These remain product direction; they are **not** in the implementation-status matrix as shipped features (or are only **partial** there).

- **Deeper compare** (richer datasheet-revision diff; CAD preview band is now shipped).
- **Tools / EE calculators** page.
- **Subcategory** search facets until backed by persisted catalog data.
- **Richer** multi-provider merge automation, **broad** datasheet extraction, and **production-grade** automatic CAD generation (deterministic KiCad `.kicad_sym` / `.kicad_mod` / `.step` emission) beyond current worker foundations.
- **More file-grounded validators** (STEP integrity, footprint pad pitch vs package geometry) and richer validation cross-reference on the part record.

## Near-Term Product Priority

After the FUNC1–FUNC18 engineering-memory wave (history: [`docs/TODO_COMPLETED_ARCHIVE.md`](docs/TODO_COMPLETED_ARCHIVE.md)), the next high-leverage build follows [`AGENTS.md`](AGENTS.md) and root [`TODO.md`](TODO.md): deepen **asset preview**, then **export** reliability, **validation/trust**, then **deeper compare** and BOM-adjacent **tools**—without blurring shipped vs planned behavior.

## What EE Library Is Not

- It is not a replacement for DigiKey, Mouser, Arrow, TraceParts, SnapEDA, or other public databases.
- It is not a live global price, stock, or compliance authority.
- It is not an automatic claim that imported provider data is approved, validated, or export-ready.
- It is not a loose notes app for circuits, connectors, and review decisions.
- It is not a production CAD generator today.
- It is not allowed to present **tools/calculators** or **deep compare** (connector/CAD-first matrices) as shipped until those capabilities exist and are listed in `docs/IMPLEMENTATION_STATUS.md`. A basic part compare route is listed when present.

## Current Boundaries

- **`/compare`** (basic readiness metrics) and **`/system`** health are in the workspace sidebar. **`/tools`** (calculators) stays out of primary navigation until that route exists.
- Exact-MPN import and supply-offer snapshots are not broad live distributor search.
- Imported does not mean approved, CAD-verified, or export-ready.
- BOM upload preserves raw context; matching and usage follow explicit operator actions and deterministic rules—weak rows do not silently become confirmed usage.
- Multi-provider conflict handling is **partial**; richer merge policy and extraction/generation depth remain **planned** (see implementation status).

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

`npm run setup:dev` creates or preserves `.env`, starts local Postgres through Docker when needed, applies migrations, seeds a local admin user, imports deterministic local-catalog sample parts, seeds a demo engineering project, and prints the login/setup summary.

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
npm run seed:demo-project
npm run dev:web
npm run dev:api
npm run dev:worker
npm run ingest:local
npm run ingest:jlcparts
npm run ingest:octopart
npm run imports:providers
npm run operations:worker
npm run refresh:supply-offers
```

The web app defaults to `http://127.0.0.1:3000`; the API defaults to `http://127.0.0.1:4000`. DB-backed search and import flows require `DATABASE_URL` to point at a reachable Postgres database. If the database is unavailable, the UI stays honest and does not invent catalog records.

Provider intake runs from the worker only and no provider key is required to run EE Library. Prefer the free providers:

- `digikey`: register a free OAuth2 app at https://developer.digikey.com and set `DIGIKEY_CLIENT_ID` plus `DIGIKEY_CLIENT_SECRET`.
- `mouser`: request a free Search API key at https://www.mouser.com/api-hub/ and set `MOUSER_API_KEY`.
- `kicad`: point `KICAD_LIBRARY_ROOT` at a checkout of public KiCad libraries to index `.kicad_sym` / `.kicad_mod` / `.step` from disk with no network calls or credentials.
- `jlcparts`: works with no credentials.

`octopart` is an optional paid aggregator accessed through the Nexar GraphQL API. It is never the default and stays inert unless `NEXAR_ACCESS_TOKEN`, or `NEXAR_CLIENT_ID` plus `NEXAR_CLIENT_SECRET`, is configured for a team that already pays for Nexar.

## Demo Engineering Walkthrough

After `npm run setup:dev` and `npm run dev`, open `http://localhost:3000/projects/project-demo-pocket-mcu`.

The seeded `DEMO-POCKET-MCU` project gives a small hardware-team loop without uploading files first:

1. Review confirmed BOM usage on the project page.
2. Open project files and advanced tools to inspect custom designs, BOM diagnostics, revision compare, BOM health, follow-ups, evidence, circuit-block reuse, and export bundle history.
3. Use `/where-used?targetType=part&q=part-tps7a02dbvr` to see the same LDO in the demo project and a prior reference project.
4. Use `/compare?parts=part-stm32g031k8t6,part-tps7a02dbvr,part-grm188r71c104ka01d,part-ci-jst-ph-housing` to compare the project parts.
5. Use `/circuit-blocks/cblock-demo-pocket-mcu-core` and `/connector-sets?q=JST-PH` to inspect reusable patterns and connector context.

The demo seed is resettable with `npm run seed:demo-project`. Weak, ambiguous, ignored, and unmatched BOM rows are seeded on purpose; only exact matched rows become confirmed project usage.

Project file reads also track internal custom designs under each project's `hardware/` folder. Folders named like `PTA-1001`, `PCA.2042`, `FIXTURE_7`, or any other letter-led team prefix plus a numeric suffix are listed with their note-file provenance; parts-list references are scanned for default, configured, and folder-discovered prefixes. The project files panel starts with a re-entry brief so an engineer reopening old work sees latest file activity, stale evidence, empty evidence folders, BOM-only design references, and missing custom-design notes before digging through folders. The same panel includes a PDF review section where another engineer can save structured redline notes against project PDFs: review category, page/sheet/area, reviewer, severity, optional correction owner, red note, requested correction, and a close-out checklist. These notes are written into the project `notes/` folder as open review items and surfaced back in the panel; they are not approvals. Set `EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES` when a parts list may mention a custom design family before its folder exists.

## First Workbench Loop

1. Open `/` or `/catalog`.
2. Paste an MPN.
3. If there is a match, scan datasheet, CAD/export, readiness, and next-action columns.
4. If an exact MPN is missing, use "Import exact MPN" from a configured provider.
5. Open the part detail page.
6. Read the use decision first, then inspect datasheet, CAD/export assets, provenance, and audit history as needed.

## Project memory loop (today)

1. Import a project BOM (CSV or XLSX) and preserve each original row, designator, quantity, note, and source file reference.
2. Match BOM rows to existing internal parts where identity is exact, or route unmatched lines through catalog intake and substitutes.
3. Use **where-used** and **connector sets** to see prior project usage and mate context.
4. Review BOM **health**, **fleet risk**, **revision compare**, **lifecycle regression**, and **approval gaps**; run **approval batch** when bulk decisions are appropriate.
5. Attach **evidence**, manage **follow-ups**, track internal **custom designs** from project files, and reuse **circuit blocks** or instantiate them into the BOM when roles match.
6. Generate **export bundles** when verified file-backed assets exist; decisions remain recorded for the next design.

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
