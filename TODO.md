# EE Library - Engineering Memory TODO

**Updated**: 2026-05-03 (through FUNC14 complete; merged onto `main`)
**Working branch**: `main` (includes merge of `cursor/2026-05-03-7o4u-787f9` engineering-memory track)
**Purpose**: Turn the shipped part-readiness foundation into a private engineering memory system for hardware teams.

**Worktree register**: dated entries live in [`REGISTER.md`](REGISTER.md) (repo root).

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
- Deterministic BOM row matching now creates confirmed project usage only for exact internal MPN/manufacturer matches.
- Part detail now exposes a where-used foundation from confirmed project usage records.
- Project detail now exposes explainable BOM health/risk findings from matched rows, approval, lifecycle, CAD/export, connector, and evidence state.
- Evidence attachment metadata can be preserved for projects, BOM records, parts/assets, usage records, and computed risk findings without changing trust state.
- Reusable circuit block records now have DB persistence, shared/API contracts, a library view, detail pages, part-role management, block evidence attachment support, and readiness-gap summaries.
- `/where-used` now searches persisted part usage and circuit block dependencies from one workspace. All four target types are now backed: parts, circuit blocks, connector sets (via mate_relations), and assets (via export bundle manifests).
- Circuit block reuse intelligence ships: `lifecycleRiskCount`, `strictSubstitutionCount`, and a `projectDependencies` section showing which projects depend on each block through confirmed BOM usage overlap.
- Project and circuit block detail pages now support metadata editing, active revision metadata edits, and circuit block part-role maintenance without changing trust state.
- `/evidence` now provides a central evidence vault with filters, review edits, and local file-backed upload through the storage layer.
- Project and circuit block detail pages now expose persisted follow-up queues generated from BOM health findings and required circuit role readiness gaps.
- Export bundle adapter MVP ships: deterministic manifest-first bundles for Altium, SolidWorks, and neutral packages from verified file-backed assets.
- XLSX BOM import support ships alongside CSV.

What is **not** shipped yet:

- ~~BOM revision comparison across project revisions.~~ Shipped via FUNC9.
- ~~Circuit block instantiation into a project BOM.~~ Shipped via FUNC11.
- ~~Export bundle download as a zip/archive from the site UI.~~ Shipped via FUNC10.
- ~~Aggregate project health fleet view across all projects.~~ Shipped via FUNC12.
- ~~Lifecycle risk change monitoring and alerting.~~ Shipped via FUNC14 (BOM health `lifecycle_risk_changed` finding when catalog moves after review checkpoint).
- ~~Part substitution management with engineering sign-off.~~ Shipped via FUNC13.
- Approval batch workflow from project BOM context.
- Connector set catalog view browsable by family and mate pairs.

That means the TODO needs to pivot. The part-readiness loop remains the foundation, but the next major product mission is now:

```txt
project/BOM intake
-> preserve original row context
-> match rows to internal parts
-> create usage history
-> review BOM health and risks
-> organize reusable circuit blocks
-> make reuse decisions evidence-backed
```

Provider data remains input. Internal engineering truth is the product.

---

## Project Review Findings

- The `.md` review shows several source/status docs still describe now-shipped memory foundations as planned. Keep TODO focused on functional next steps, and sync `docs/IMPLEMENTATION_STATUS.md`, `README.md`, and roadmap/status wording after the feature wave settles.
- Code now has a shipped project/BOM memory foundation for persisted project records, revisions, BOM imports, BOM lines, confirmed usage, project creation, CSV and XLSX BOM upload/mapping, deterministic BOM matching, part where-used, BOM health, evidence metadata/vault workflows, circuit block records, project/block editing, follow-up queues, connector-set and asset where-used (via mate relations and export bundle manifests), and export bundle adapter MVP.
- Existing readiness, approval, asset, connector, validation, evidence, and circuit block records now feed explainable BOM health and circuit reuse foundations.
- Existing migration and test infrastructure is ready for a careful schema-first implementation.
- The old TODO still prioritized memory foundations as next work. That is now stale: the P0-MEM series is complete, so the next P0 direction should make the site more functional for daily engineering use.

---

## Recommended Next Tasks

Work these in order. Keep each task honest about shipped foundations versus full product behavior.

1. **[P0-FUNC1] Add cross-object where-used search - done 2026-05-01**
   - Create a real where-used workspace that can search confirmed project usage and circuit block dependencies.
   - Start with parts and circuit blocks because those records now exist.
   - Keep connector-set and asset where-used states honest until persisted links exist.

2. **[P0-FUNC2] Add project and circuit block editing - done 2026-05-02**
   - Let users update project metadata, project status, circuit block metadata/status, reuse scope, constraints, and part-role notes.
   - Preserve trust boundaries: edits must not silently approve parts, validate evidence, or unlock export.
   - Keep changed-at/changed-by style metadata where the schema supports it.

3. **[P0-FUNC3] Build evidence vault MVP - done 2026-05-02**
   - Add a central evidence browser with target filters, review status filters, and link/file metadata.
   - Add real local file upload through the storage layer instead of metadata-only URLs.
   - Keep evidence review separate from validation, approval, and export readiness.

4. **[P0-FUNC4] Persist follow-up work from BOM health and circuit gaps - done 2026-05-02**
   - Convert explainable BOM health findings and circuit block readiness gaps into assignable follow-up records.
   - Track status, assignee, severity, source inputs, evidence links, and resolution notes.
   - Keep computed findings explainable and refreshable from underlying project/BOM/part truth.

5. **[P0-FUNC5] Add export bundle adapter MVP - DONE**
   - Generate deterministic manifest-first bundles for Altium, SolidWorks, and a neutral file package.
   - Include only verified file-backed assets and emit explicit warnings for missing or referenced-only assets.
   - Preserve provenance and deterministic naming in every bundle manifest.

6. **[P1-FUNC6] Improve BOM import diagnostics, XLSX intake, and revision compare - DONE**
   - Add broader file handling after CSV is stable.
   - Compare BOM imports across project revisions.
   - Make weak, ambiguous, unmatched, and newly imported rows easier to triage.

7. **[P1-FUNC7] Add circuit block reuse intelligence - DONE 2026-05-02**
   - Added `lifecycleRiskCount` (required parts with obsolete/not_recommended lifecycle) and `strictSubstitutionCount` (parts with exact_required/do_not_substitute policy) to CircuitBlockSummary.
   - Added `projectDependencies: CircuitBlockProjectDependency[]` to CircuitBlockDetailResponse, backed by a reverse JOIN on `project_part_usages` and `circuit_block_parts`.
   - Added `/circuit-blocks/:blockId/project-dependencies` API route and a Dependent Projects section on the block detail page.

8. **[P1-FUNC8] Back connector-set and asset where-used with persisted links - DONE 2026-05-02**
   - Connector-set: finds connector parts (connector_class IS NOT NULL) by MPN, then finds mates from `mate_relations` (best_mate/alternate_mate), returns project usages for the matched connector + mates.
   - Asset: queries `export_bundles.manifest JSONB` via LATERAL `jsonb_array_elements()` to find bundles containing assets for the matched part's MPN.
   - Updated `getUnsupportedWhereUsedReason` to return null for all four target types. All four are now backed.
   - Added `WhereUsedAssetExportTable` to the where-used workspace UI.

---

## Next Wave — Ultimate Functionality

These are the highest-value tasks remaining to make the product a daily-use engineering memory system.

### P1-FUNC9 — BOM Revision Comparison — DONE 2026-05-02

**Priority**: P1
**Why it matters**: Teams need to see what changed between revision A and B — which parts were added, removed, swapped, or changed in quantity or designator.

**Expected outcome**:
- `/projects/:projectId/revisions/compare?from=revA&to=revB` returns a diff of BOM line changes.
- Changes grouped by: added parts, removed parts, quantity/designator changes, MPN swaps.
- Part identity uses confirmed matched records where available, raw MPN as fallback.
- UI renders a compact diff table on the project detail page.

**Completion notes**:
- Added `GET /projects/:projectId/revisions/compare?from=<id>&to=<id>` API route, registered in the dispatcher and route telemetry classifier as `api-project-revision-compare`.
- Added `readProjectRevisionCompareFromDatabase` to `apps/api/src/project-memory-store.ts`. Aggregates BOM lines across every `bom_imports` row under each revision, collapsing duplicates by identity key (`matched_part_id` when present, otherwise normalized `raw_mpn`, otherwise `bom_import_id+row_number`). Quantities sum across imports and designator lists merge.
- Diff classifier emits the explicit FUNC9 groupings: `added`, `removed`, `mpn_swap` (same matched part, different raw MPN), `quantity_changed`, `designator_changed`, and `unchanged`. Returns per-side from/to snapshots plus contributing `bom_import_ids` for transparency.
- Validation returns `IDENTICAL_REVISIONS` (400), `PROJECT_NOT_FOUND` (404), or `REVISIONS_NOT_FOUND` (404) for the obvious bad-input paths without leaking other errors.
- Added shared types: `ProjectRevisionCompareResponse`, `ProjectRevisionCompareRow`, `ProjectRevisionCompareSide`, `ProjectRevisionCompareChangeKind`, `ProjectRevisionCompareIdentityKind`. Existing import-vs-import compare types (`BomRevisionCompareResponse`/`Row`) left untouched for backward compatibility.
- Added `fetchProjectRevisionCompare` to `apps/web/src/lib/api-client.ts`.
- Extended `BomDiagnosticsPanel` with a new "Revision compare" section that takes from/to revision selectors and renders the change groupings as count badges plus a compact diff table. Renamed the existing import-level section to "Import compare" so the labels stay honest. Threaded `revisions` through from the project detail page.
- Tests: three new pg-mem-backed cases in `project-memory-store.test.ts` covering identical/missing input rejection, an end-to-end add/remove/MPN-swap diff, and an MPN-stable quantity-change diff. Full API/web/shared suites green (112 / 81 / 47).

### P1-FUNC10 — Export Bundle Download UI — DONE 2026-05-02

**Priority**: P1
**Why it matters**: The export bundle adapter creates manifests and zip bundles, but there is no site UI to trigger a download or show bundle history for a project.

**Expected outcome**:
- Project detail shows a list of export bundles generated for the project.
- Each bundle shows format, created-at, manifest warnings, and a download link.
- Download goes through the existing `/storage/:key` route for file-backed bundles.
- Referenced-only and missing-asset warnings appear inline, not buried in logs.

**Completion notes**:
- Added `buildExportBundleDownloadUrl(storageKey)` helper in `apps/web/src/lib/api-client.ts`. Returns a URL pointing at the existing `/storage/:encodedKey` API route for file-backed bundles, or `null` for manifest-only bundles.
- Added a Download column to `ExportBundlePanel`. File-backed bundles render an `<a download>` link that streams from the storage route; manifest-only bundles render a tooltipped "Manifest only" muted label so the user knows why no link is offered.
- Added `collectInlineBundleWarnings` to surface `referenced_only`, `missing`, and `not_verified_for_export` omission counts plus the manifest's own warnings as inline `form-feedback--warning` items directly under each bundle row, instead of requiring the user to expand the manifest.
- The bundle history panel was already mounted on the project detail page (Section 10) and was already rendering format, parts, included/omitted counts, warning count, generated timestamp, and an expandable manifest. FUNC10 just closes the missing download + inline-warning gaps.
- All workspaces typecheck. Web/API/shared test suites green (81 / 112 / 47).

### P1-FUNC11 — Circuit Block Instantiation Into Project BOM — DONE 2026-05-02

**Priority**: P1
**Why it matters**: The main value of a circuit block library is being able to say "add the Alpha Power block to Project Beta." Without instantiation, engineers copy manually and reuse is invisible.

**Expected outcome**:
- Project detail has an "Add circuit block to BOM" action.
- Selects a block and maps its required/optional parts to BOM line candidates or creates them.
- Creates BOM lines and usage records for matched internal parts only.
- Preserves which BOM lines came from a block instantiation for future comparison.
- Does not change part approval, readiness, or export state.

**Completion notes**:
- Migration `029_circuit_block_instantiation.sql`: new `circuit_block_instantiations` table records each instantiation event (block id, project id, revision id, synthetic bom_import id, includeOptional flag, designator prefix, notes, actor, created timestamp). `bom_lines` gets three nullable columns — `instantiated_from_circuit_block_id`, `instantiated_from_circuit_block_part_id`, `instantiated_at` — preserved as FK references so revision compare and where-used can attribute lines back to the originating block role. Hand-imported lines stay backwards-compatible (columns are NULL).
- Shared types: extended `BomLine` with the three instantiation fields. Added `CircuitBlockInstantiation`, `CircuitBlockInstantiationCreateInput`, and `CircuitBlockInstantiationCreateResponse`.
- Store: `instantiateCircuitBlockIntoProjectBomInDatabase` validates project + revision-on-project + block existence, reads the block's part roles (required, plus optional when `includeOptional` is true), creates a synthetic `bom_imports` row with `source_format='manual'` and a deterministic name (`Circuit block: <name> (<block_key>)`), inserts a matched BOM line per role pre-populated with the catalog MPN/manufacturer + auto-numbered designators when a prefix is provided, upserts a confirmed `project_part_usages` row through the existing helper, and writes the `circuit_block_instantiations` envelope. Everything happens in one transaction; failures roll back. Returns `matchedLineCount`, `skippedOptionalCount`, and an explicit boundary string clarifying that approval/readiness/export are unchanged.
- API route: `POST /projects/:projectId/circuit-block-instantiations` (admin-only). Returns 201 on success; 400 for invalid input; 404 for `PROJECT_NOT_FOUND` / `PROJECT_REVISION_NOT_FOUND` / `CIRCUIT_BLOCK_NOT_FOUND`. Telemetry classifier: `api-circuit-block-instantiation-create`.
- Web: `instantiateCircuitBlockIntoBom` client + new `CircuitBlockInstantiationPanel` mounted on the project detail page (Section 07) under "Add circuit block to BOM". Loads the circuit block library client-side, lets the user pick a block, target revision, optional designator prefix, and `includeOptional` toggle; shows a success message with the matched-line count, skipped-optional count, and an explicit trust-boundary note.
- Tests: three new pg-mem-backed cases — missing project / missing revision / missing block all return the right `not_found` codes; happy path verifies a synthetic BOM import is created with the right source_format/source_filename, one matched BOM line with `matchedPartId`, `instantiatedFromCircuitBlockId`, `instantiatedFromCircuitBlockPartId`, and the auto-numbered designator, plus a confirmed `project_part_usages` row pointing at the new line. Migration discovery picks up the new SQL file. All workspaces typecheck. API/web/shared/migration suites green (114 / 81 / 47 / 8).

### P1-FUNC12 — Aggregate Project Health Fleet View — DONE 2026-05-02

**Priority**: P1
**Why it matters**: Hardware leads managing multiple projects need to know which projects are most at risk without opening each one.

**Expected outcome**:
- Projects dashboard gets a risk summary sidebar or table: unmatched rows, approval gaps, lifecycle risk count, missing CAD count, open follow-ups.
- Sort by risk column so the most at-risk project rises to the top.
- Counts link directly to the relevant project detail section.
- No opaque scores — every count has a drill-down path.

**Completion notes**:
- Shared types: `ProjectFleetRiskRow` (per-project unmatched / weak-or-ambiguous / approval-gap / lifecycle-risk / missing-verified-CAD / open-follow-up + transparent additive `totalRiskCount`) and `ProjectFleetRiskResponse` with explicit boundary copy.
- Store: `readProjectFleetRiskFromDatabase` walks every persisted project, reuses the existing `readProjectBomHealthRows` SQL plus a small `follow_up_records` count query, aggregates the five BOM-derived counts, and returns rows sorted by `totalRiskCount` desc (tie-broken by name). Stays explainable — `totalRiskCount` is just the sum of the visible columns, not a hidden weighted score.
- API route: `GET /projects/health-summary` registered before the generic `/projects/:projectId` matcher so the literal path wins. Telemetry classifier `api-project-fleet-risk`.
- Web client: `fetchProjectFleetRisk`.
- UI: new "Fleet risk dashboard" section on `/projects` (index 02). Renders a per-project table with the seven count columns, a `StatusBadge` total tone (verified <1, review 1-4, danger >=5), and `FleetCountLink` cells that drill into the right project detail anchor (`#project-bom-diagnostics-heading`, `#project-risk-heading`, `#project-follow-ups-heading`). Zero counts render as muted "0" without a link, so the user always sees where the work is. The fleet-risk fetch failure is non-fatal — the dashboard still renders the project list when the new endpoint is unreachable.
- Tests: three new pg-mem-backed cases — not_configured without DATABASE_URL, configured-empty fleet returns `state: "empty"`, and the seeded fixture project shows the expected counts (1 weak/ambiguous BOM line + 1 missing-verified-CAD with totalRiskCount = 2). All workspaces typecheck. API/web/shared suites green (117 / 81 / 47).

### P2-FUNC13 — Part Substitution Management With Engineering Sign-Off — DONE 2026-05-02

**Priority**: P2
**Why it matters**: Parts become obsolete. Substitution decisions need engineering sign-off, not a "compatible part" flag from a provider feed.

**Expected outcome**:
- Catalog part detail has an "Add approved substitute" action.
- Substitution records capture: alternate MPN, substitution scope (project-specific vs. global), sign-off notes, and approver.
- BOM matching can optionally consider approved substitutes for weak-match rows.
- Circuit block substitution policy (exact_required, do_not_substitute, etc.) surfaces as risk in BOM health where alternates are being considered.

**Completion notes**:
- Migration `030_part_substitutions.sql`: new `part_substitutions` table with original/substitute part FKs, scope (`global` vs `project`), optional `project_id` FK gated by a CHECK constraint, sign-off notes, approver, status (`approved`/`revoked`), and revoke-by/revoked-at audit columns. Self-substitution is prevented at the DB level. A unique partial index keeps only one approved row per (original, substitute, optional project) tuple while still allowing revoked history to stack.
- Shared types: `PartSubstitutionScope`, `PartSubstitutionStatus`, `PartSubstitution`, `PartSubstitutionSummary` (joined with both sides' MPN/manufacturer + project name), `PartSubstitutionListResponse`, `PartSubstitutionCreateInput`, `PartSubstitutionCreateResponse`, `PartSubstitutionRevokeResponse`. Extended `BomImportDiagnosticsRow` with `approvedSubstituteHints: ApprovedSubstituteHint[]`.
- Store: `createPartSubstitutionInDatabase` validates self/scope/projectId rules, checks both parts and the (optional) project exist, blocks duplicate active approvals, and writes the record. `readPartSubstitutionsForPartFromDatabase` returns active and revoked rows from BOTH directions (so engineers see substitutions where the part is the alternate too). `revokePartSubstitutionInDatabase` flips status with audit metadata; double-revoke returns `ALREADY_REVOKED`. New helper `readApprovedSubstituteHintsForRawMpn(databasePool, rawMpn, projectId)` does a case-insensitive raw-MPN match against catalog parts and pulls approved substitutions (global + project-scoped) where either side matches; the BOM diagnostics reader now joins these hints onto every non-matched row and adds a triage action line.
- API routes: `POST /parts/:partId/substitutions` (admin), `GET /parts/:partId/substitutions`, `POST /substitutions/:substitutionId/revoke` (admin). Telemetry classifiers: `api-part-substitution-create`, `api-part-substitutions-read`, `api-part-substitution-revoke`. Standard 400/404/409 mapping for invalid/missing/duplicate.
- Web client: `fetchPartSubstitutions`, `createPartSubstitution`, `revokePartSubstitution`.
- Web UI: new `PartSubstitutionPanel` mounted on the part detail page as section 04b ("Approved substitutes"), right after Alternates. Provides the create form (substitute id + scope + optional project + sign-off notes), shows active substitutes with a Revoke link, and shows revoked history with the revoker + date. The panel surfaces direction (`this -> alternate` vs `alternate -> this`) so engineers see substitutions where the current part is the alternate as well. `BomDiagnosticsPanel` now renders an inline `Substitute: <MPN> (<scope>)` info badge per matching hint inside the diagnostics row's status cell.
- Tests: three new pg-mem cases — create happy path + self-substitution + missing-part + duplicate, list-from-both-sides + revoke + double-revoke, and BOM diagnostics surfacing `approvedSubstituteHints` on a seeded weak BOM line whose raw MPN maps onto an approved substitution. Migration discovery picks up the new SQL file. All workspaces typecheck. API/web/shared/migration suites green (120 / 81 / 47 / 9).

### P2-FUNC14 — Lifecycle Risk Change Monitoring — DONE 2026-05-03

**Priority**: P2
**Why it matters**: A part approved today can become obsolete or not_recommended next quarter. Projects using it should surface that change without manual catalog audits.

**Expected outcome**:
- `/projects/:projectId/bom-health` recalculates lifecycle risk from current part state, not the snapshot at matching time.
- A new `lifecycle_risk_changed` finding fires when a confirmed usage part moves to obsolete/not_recommended after the last BOM health review.
- Follow-up sync includes lifecycle change findings so risk is assignable.

**Completion notes**:
- BOM health SQL now exposes `matched_part_last_updated_at` on joined rows so regressions tie to **when the catalog row last changed**, not the BOM import snapshot.
- `readProjectBomHealthReviewCheckpointAt` defines the review baseline as the latest of: resolved/dismissed `follow_up_records` for this project with `source_type = 'bom_health'`, and accepted `evidence_attachments` tied to `risk_finding` targets for this project’s BOM-health findings.
- `buildProjectBomHealthResponse` classifies **lifecycle regression** rows: matched lines where lifecycle is `obsolete` or `not_recommended`, catalog `last_updated_at` is after the checkpoint, and the row is not already counted in the standing `lifecycle_risk` bucket for the same pass (dedupe via grouping).
- `pushLifecycleRegressionFinding` emits finding code `lifecycle_risk_changed` with explainable inputs and severity driven by obsolete vs not_recommended.
- Shared type `ProjectBomRiskFindingCode` includes `lifecycle_risk_changed`.
- Tests: pg-mem case `project memory store surfaces lifecycle_risk_changed when catalog moves after a BOM health review checkpoint` in `apps/api/src/project-memory-store.test.ts`.

### P2-FUNC15 — Connector Set Catalog View

**Priority**: P2
**Why it matters**: Connector family selection is a real design decision. Engineers need to browse connector families, see mate pairs, and check what's approved vs. what's in use.

**Expected outcome**:
- New `/connector-sets` workspace or catalog filter shows connectors grouped by connector_class.
- Mate pairs link to each other with best_mate/alternate_mate labels.
- Connector set view shows which projects use each connector/mate combination from confirmed usage.
- Reuses existing mate_relations data — no new schema needed.

### P2-FUNC16 — Approval Batch Workflow From Project BOM Context

**Priority**: P2
**Why it matters**: Reviewing and approving 80 parts one at a time for a new project is painful. The approval workflow should be drivable from a project BOM health finding list.

**Expected outcome**:
- Project BOM health page has a "Review approval gaps" action that shows all unapproved confirmed-usage parts.
- Bulk approve or flag-for-review from that list with a single admin action.
- Approval decisions record project context as the trigger (not just a standalone approval event).

The completed P0-MEM foundation tasks are retained below for context and regression planning.

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
**Status**: Done 2026-05-01. Added deterministic internal BOM matching, a match API route, confirmed usage creation, project detail match controls, and unmatched exact-MPN routing into the existing provider import path.

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

**Completion notes**:

- Added exact internal MPN/manufacturer matching for persisted BOM imports.
- Kept missing-manufacturer exact MPN rows as weak matches and duplicate exact MPN rows as ambiguous.
- Created or refreshed `ProjectPartUsage` only for confirmed matches, with approval/readiness snapshots captured as evidence.
- Added a project detail match action and import links for unmatched exact MPN rows.

---

## P0-MEM6 - Add Where-Used Foundation

**Priority**: P0
**Status**: Done 2026-05-01. Added part-scoped where-used contracts, API route, joined store read, part-detail panel, unavailable/empty states, and tests for confirmed usage display without changing approval/export labels.

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

**Completion notes**:

- Added `/parts/:partId/usages` as a provider-neutral where-used route backed by confirmed `ProjectPartUsage` rows.
- Joined project, revision, BOM-line, designator, quantity, usage status, and usage context into the part detail workspace.
- Kept usage history explicitly separate from whole-part approval, generated-asset review, and export readiness.
- Added empty and unavailable states so seed fallback or missing project memory does not create fake history.

---

## P0-MEM7 - Add BOM Health And Risk Projection MVP

**Priority**: P0
**Status**: Done 2026-05-01. Added computed project BOM health contracts, API route, project detail dashboard, explainable risk findings, and tests for readiness gaps without opaque scores.

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

**Completion notes**:

- Added `/projects/:projectId/bom-health` as a computed, provider-neutral health read backed by persisted BOM lines, matched parts, approval snapshots, readiness summaries, assets, and evidence metadata.
- Derived explainable counts for match state, approval gaps, lifecycle risk, missing verified CAD/export assets, referenced-CAD-only rows, connector buildability gaps, and missing evidence.
- Rendered a project detail BOM health panel with concrete next actions and input rows instead of an opaque score.
- Kept export readiness tied to verified file-backed assets, so referenced CAD or approval status does not unlock export.

---

## P0-MEM8 - Add Evidence Attachment Foundation

**Priority**: P0
**Status**: Done 2026-05-01. Added evidence attachment persistence, shared/API contracts, admin-gated create route, project evidence read route, metadata UI, and regression coverage that evidence does not alter trust state.

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

**Completion notes**:

- Added `evidence_attachments` persistence with target type, evidence type, source/storage metadata, provenance, review status, and uploaded-by fields.
- Added `/projects/:projectId/evidence` and `POST /evidence-attachments` routes with target existence checks and admin protection for writes.
- Added a project detail evidence section and metadata form for project-level links/notes.
- Verified evidence attachments reduce only the missing-evidence project-health gap and do not change approval, validation, or export readiness.

---

## P0-MEM9 - Add Circuit Block Records

**Priority**: P0
**Status**: Done 2026-05-01. Added circuit block persistence, shared/API contracts, library and detail pages, part-role creation, block evidence support, readiness-gap summaries, and regression coverage.

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

**Completion notes**:

- Added `circuit_blocks` and `circuit_block_parts` persistence, including evidence target support for circuit blocks and block-part roles.
- Added shared contracts and API routes for block list, block detail, block creation, and block-part role creation.
- Added `/circuit-blocks` and `/circuit-blocks/[blockId]` surfaces with honest empty/setup states, part readiness context, required/optional role separation, evidence metadata, and trust boundaries.
- Verified circuit block status does not override part approval, readiness blockers, or export readiness.

---

# P0: Site Functionality Expansion

The memory foundation exists. The next wave should turn those records into faster daily engineering workflows.

---

## P0-FUNC1 - Add Cross-Object Where-Used Search

**Priority**: P0
**Status**: Done 2026-05-01. Added a global `/where-used` workspace, API route, shared contracts, part and circuit block dependency reads, navigation, and tests while keeping connector-set and asset targets as honest planned states.

**Why it matters**: Part detail can answer a narrow where-used question, but engineers need a workspace that searches reuse across projects, BOMs, and circuit blocks.

**Expected outcome**:

- New where-used route and page.
- Search by part MPN/id and circuit block key/id.
- Results grouped by project, revision, BOM import, usage status, designator, quantity, and circuit block role.
- Empty states for unsupported connector-set and asset where-used searches until those links are persisted.

**Files to inspect or modify**:

- `packages/shared/src/`
- `apps/api/src/project-memory-store.ts`
- `apps/api/src/index.ts`
- `apps/web/src/app/where-used/`
- `apps/web/src/components/AppNavigation.tsx`

**Tests**:

- Confirmed project usage appears in global where-used results.
- Circuit block part membership appears as dependency context without implying project release.
- Unsupported target types show honest empty/planned states.

**Done when**:

- A user can answer "where have we used or depended on this?" from one site surface.

**Completion notes**:

- Added `GET /where-used?targetType=part&q=...` for internal part id/MPN search across confirmed project usage and circuit block dependencies.
- Added `GET /where-used?targetType=circuit_block&q=...` for circuit block id/key/name search with linked part roles and indirect project usage context.
- Rendered `/where-used` with project/revision/designator/quantity/status, BOM row, part, and circuit-role context.
- Kept connector-set and asset targets visible but explicitly unsupported until persisted where-used links exist.
- Preserved the trust boundary that where-used history does not approve reuse, validate evidence, or unlock export.

---

## P0-FUNC2 - Add Project And Circuit Block Editing

**Priority**: P0
**Status**: Done 2026-05-02. Added shared/API update contracts, admin-gated PATCH routes, DB update helpers, project/revision edit UI, circuit block metadata edit UI, editable part-role rows, and regression coverage for trust-boundary behavior.

**Why it matters**: The site can create records, but real teams need to correct metadata, change status, and refine constraints after the first pass.

**Expected outcome**:

- Edit project name, owner, status, notes, and active revision metadata.
- Edit circuit block name, owner, status, reuse scope, description, constraints, and role notes.
- Update required/optional flags, quantity, and substitution policy for circuit block parts.
- Use existing updated timestamps and add audit records only if the schema already has a safe local pattern.

**Tests**:

- Edits persist and re-render on detail pages.
- Editing status does not approve parts, validate evidence, or alter export readiness.
- Invalid enum/status values are rejected by shared/API validation.

**Done when**:

- Project and circuit block records can be maintained without database-only fixes.

**Completion notes**:

- Added project metadata editing for name, owner, status, and description/notes using existing project columns and updated timestamps.
- Added active revision metadata editing for status, source reference, and release timestamp without remapping BOM rows.
- Added circuit block metadata editing for name, owner, status, type, reuse scope, description, and constraints.
- Added editable circuit block part roles for required/optional state, quantity, substitution policy, and notes while keeping part identity read-only.
- Verified edits do not approve parts, validate evidence, alter readiness, create usage, or unlock export.

---

## P0-FUNC3 - Build Evidence Vault MVP

**Priority**: P0
**Status**: Done 2026-05-02. Added shared/API evidence vault contracts, filtered vault read route, file upload route through storage, review update route, `/evidence` workspace, generic vault attach form, and regression coverage for file-backed/link-only/review boundaries.

**Why it matters**: Evidence is useful only if engineers can find, filter, review, and attach it without opening every project or block one at a time.

**Expected outcome**:

- New evidence vault page with filters for target type, evidence type, review status, source system, and storage state.
- Local file upload path using the existing storage layer.
- Attach evidence to projects, BOM imports, BOM lines, usage records, risk findings, circuit blocks, and block parts where target records exist.
- Review metadata remains separate from asset validation, part approval, and export readiness.

**Tests**:

- File-backed evidence stores stable storage metadata and hash/provenance where available.
- Link-only evidence remains link-only and is not exportable.
- Evidence review changes do not change part approval or verified-for-export state.

**Done when**:

- Evidence can be managed as a first-class workspace without overclaiming trust.

**Completion notes**:

- Added `GET /evidence-attachments` with target, evidence type, review status, source system, storage state, and text filters.
- Added admin-gated file upload through the existing storage layer with deterministic evidence storage keys, SHA-256 hashes, MIME metadata, and provenance.
- Added admin-gated evidence review edits that update evidence rows only and do not validate assets, approve parts, or unlock export.
- Added `/evidence` with vault filters, attach controls for supported target ids, review editing, file/link/note visibility, and evidence trust-boundary copy.
- Verified file-backed evidence stays provenance and link-only evidence remains non-exportable.

---

## P0-FUNC4 - Persist Follow-Up Work From BOM Health And Circuit Gaps

**Priority**: P0
**Status**: Done 2026-05-02. Added `follow_up_records` migration/schema, shared/API contracts, project and circuit sync/read/update routes, project/block follow-up panels, and regression coverage for dedupe, refresh, evidence links, and readiness boundaries.

**Why it matters**: Computed risk is helpful, but teams need assignable work to close BOM and circuit reuse gaps.

**Expected outcome**:

- Persist follow-up records for BOM health findings, circuit block readiness gaps, missing evidence, approval gaps, lifecycle risk, and missing verified CAD/export assets.
- Track severity, status, assignee, source inputs, related evidence, and resolution notes.
- Show project/block follow-up queues and reuse existing admin queue patterns where possible.

**Tests**:

- Generated follow-ups preserve source inputs and do not duplicate existing open work.
- Resolved follow-ups stay auditable even if computed risk later changes.
- Follow-up status does not alter readiness unless the underlying part/evidence/asset state changes.

**Done when**:

- A hardware lead can turn BOM or circuit risk into visible, owned work.

**Completion notes**:

- Added persistent follow-up records with target, computed source, severity, workflow status, assignee, source inputs, related evidence ids, and resolution notes.
- Added project follow-up sync from current BOM health findings and circuit block sync from required-role approval/readiness gaps.
- Preserved operator-owned workflow state on refresh so existing follow-ups are updated without duplicate open work.
- Added project and circuit block detail follow-up queues with refresh and row edit actions.
- Verified follow-up status does not change part approval, evidence review, readiness summaries, or export state.

---

## P0-FUNC5 - Add Export Bundle Adapter MVP

**Priority**: P0
**Status**: Done 2026-05-02. Added deterministic manifest-first export bundles, Altium/SolidWorks/neutral format adapters, file-backed asset inclusion, provenance manifest records, and export bundle diagnostics panel. Asset where-used now queries bundle manifests (FUNC8).

**Why it matters**: The product promise ends at export, and export actions must reflect real verified file-backed assets.

**Completion notes**:

- Added manifest-first bundles for Altium, SolidWorks, and neutral package formats.
- Included only verified file-backed assets; emitted explicit warnings for missing or referenced-only assets.
- Preserved provenance, deterministic naming, and per-asset records in every manifest.
- Export bundle manifests now power the asset where-used feature (FUNC8) via JSONB manifest queries.

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
- Deterministic BOM row matching and confirmed usage creation.
- Part detail where-used foundation from confirmed project usage.
- Project BOM health and explainable risk projection foundation.
- Evidence attachment metadata foundation.
- Reusable circuit block records, part roles, evidence, and readiness-gap foundation.
- Global where-used workspace for part usage and circuit block dependencies.
- Project and circuit block metadata editing, active revision editing, and circuit block part-role maintenance.
- Evidence vault MVP with file upload, review editing, and target-scoped filters.
- Follow-up work persistence from BOM health findings and circuit block readiness gaps.
- Export bundle adapter MVP with manifest-first bundles for Altium, SolidWorks, and neutral packages.
- XLSX BOM import support alongside CSV.
- Circuit block reuse intelligence: lifecycle risk counts, substitution counts, and dependent project discovery from confirmed usage overlap.
- All four where-used target types backed: parts, circuit blocks, connector sets (via mate_relations), and assets (via export bundle manifests).

---

# Execution Plan

## Phase 1 - Memory Schema And Contracts

**P0-MEM1** and **P0-MEM2** are complete.

Goal met: project/BOM memory has durable persistence and typed API/shared contracts before UI claims exist.

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

**P0-MEM5** and **P0-MEM6** are complete.

Goal met: confirmed BOM matches create usage history, and users can answer where a part has been used from part detail.

Verification:

```bash
npm run typecheck
npm test
```

## Phase 4 - BOM Health, Evidence, And Circuit Blocks

**P0-MEM7**, **P0-MEM8**, and **P0-MEM9** are complete.

Goal met: project memory becomes actionable through structured circuit reuse on top of shipped risk review and evidence metadata foundations.

Verification:

```bash
npm run typecheck
npm test
npm run smoke:local
```

## Phase 5 - Site Functionality Expansion

**P0-FUNC1** through **P0-FUNC5**, **P1-FUNC6**, **P1-FUNC7**, and **P1-FUNC8** are complete.

Goal: all memory foundations and where-used targets are now backed. Next wave (FUNC9–FUNC16) focuses on daily workflow depth: revision comparison, export download UI, circuit block instantiation, and fleet health visibility.

Verification:

```bash
npm run typecheck
npm test
npm run smoke:local
```

---

# Non-Goals For The Next P0 Wave

- Do not build live distributor search as a substitute for internal project memory.
- Do not present BOM revision comparison, circuit block instantiation, export bundle download UI, or fleet health view as shipped until implemented.
- Do not let BOM import silently create approved parts.
- Do not let weak BOM matching create confirmed usage.
- Do not let evidence attachments imply validation, approval, or export readiness.
- Do not let circuit block status or membership imply part approval, validated evidence, or export readiness.
- Do not build compare/tools before project memory has a usable foundation.
- Do not pursue broad provider ecosystem work before project/BOM memory can preserve internal decisions.

Next, make the remembered project and circuit knowledge usable every day.
