# EE Library — Prioritized TODO

**Branch**: `codex/phase-2-foundation`
**Generated**: 2026-04-24
**Based on**: Full codebase audit of apps/api, apps/web, apps/worker, packages/db, packages/shared, packages/ui, infra/postgres (21 migrations)

---

## Recommended Next 5 Tasks

These are the highest-leverage items that unblock everything else. Work them in order.

1. ~~**[P0-1] Add asset download/redirect endpoint**~~ ✓ **Done** — `GET /parts/:partId/assets/:assetId/download` added to API. Redirects to `source_url` for referenced/downloaded assets, returns 501 for storage-key-only assets (pending P0-2), 404 for missing/failed. Download/View source links wired into the part detail asset cards. 8 route tests added.

2. **[P0-3] Extract package dimensions from JLC Parts structured attributes** — `body_length_mm`, `body_width_mm`, `pitch_mm`, and `body_height_mm` are all hardcoded `null` in the JLC Parts adapter despite many JLC components carrying `Pitch` and `Package` dimension attributes. Without these, draft footprint generation produces no useful geometry for any JLC-sourced part. Fix the attribute extraction in `jlcparts-provider.ts:buildPackage()`.

3. **[P1-1] Make datasheet enrichment actually download the PDF** — `datasheet_capture` enrichment jobs currently record only the URL reference in `source_records.raw_payload`. The `captured_datasheet_url` field records that a URL was seen but no file is ever fetched, hashed, or stored. This makes the entire enrichment job pipeline a no-op for data trust purposes. Implement a fetch-and-store step in `provider-enrichment-jobs.ts:processDatasheetCaptureJob()`.

4. **[P1-4] Write tests for the new catalog search page** — `apps/web/src/app/catalog/page.tsx` was added in this branch with no test file. Every other page in the web app has a corresponding `*.test.ts`. Given the catalog page hosts the filter rail, provider lookup panel, import panel, and quick-check form, missing test coverage here is a real regression risk.

5. **[P1-5] Add bulk readiness recompute worker command** — After `npm run ingest:jlcparts` + `npm run imports:providers`, every newly imported part has a freshly computed readiness summary. But if the readiness projection logic changes (e.g., new issue codes, new confidence thresholds), there is no way to recompute all summaries in batch. Add `npm run recompute:readiness` to `apps/worker/src/index.ts` that pages through all parts and calls `derivePartProjection()` in batches.

---

## P0: Blocking or Mission-Critical

These block the core product promise or will cause silent data dishonesty at scale.

---

### ~~P0-1 · Add asset download/redirect endpoint~~ ✓ DONE

**Completed**: 2026-04-24
**What was done**:
- Added `readAssetDownloadTargetFromDatabase(partId, assetId)` to `apps/api/src/catalog-store.ts` — queries `assets` table for the minimum fields needed to resolve a download, returns typed `AssetDownloadTargetResult`
- Added `GET /parts/:partId/assets/:assetId/download` route to `apps/api/src/index.ts` — 302 redirect to `source_url` for `referenced`/`downloaded`/`validated` assets that have a URL; 501 for storage-key-only assets (pending P0-2 storage backend); 404 for `missing` and `failed`
- Added `sendRedirect()` helper to `apps/api/src/index.ts`
- Added `buildAssetDownloadUrl(partId, assetId)` export to `apps/web/src/lib/api-client.ts`
- Wired "Download" / "View source" links into `EngineeringAssetSummary` in `apps/web/src/app/parts/[partId]/page.tsx`
- Created `apps/api/src/asset-download-route.test.ts` with 8 tests covering all result states
**Dependencies**: P0-2 (storage backend) needed for `file_only` assets to return 302 instead of 501

---

### P0-2 · Define and document the file storage strategy

**Priority**: P0
**Why it matters**: `storage_key` is stored in the `assets` table but there is no implementation that writes or reads actual files. The acquisition pipeline sets `storage_key` for fixture data (e.g., `cad/a.step`) but nothing ever writes those bytes anywhere accessible. At scale, downloaded files need a durable backend (local path in dev, object storage in production). Without a decision here, every `downloaded` / `validated` asset status is fictional.
**Expected outcome**: A documented decision (ADR or CLAUDE.md entry) on storage backend (local filesystem for dev, S3-compatible for production). A `FileStorageClient` abstraction in `packages/shared` or `apps/api` that can write/read/sign URLs, backed by environment variables. Update `datasheet_capture` enrichment job to write through this abstraction.
**Files to inspect or modify**:
- `packages/shared/src/types.ts` — `storageKey` field on `Asset`
- `apps/worker/src/catalog-repository.ts` — where `storage_key` is persisted
- `apps/worker/src/provider-enrichment-jobs.ts` — `processDatasheetCaptureJob`
- `infra/postgres/` — no new migration needed; schema already has `storage_key`
**Tests**:
- Integration test that writes a file and reads it back via download endpoint
**Risk**: High — infrastructure decision; keeps local-only as a safe default for now
**Dependencies**: Unblocks P0-1 streaming path for `downloaded`/`validated` assets; P1-4 PDF download

---

### P0-3 · Extract package body dimensions from JLC Parts structured attributes

**Priority**: P0
**Why it matters**: `body_length_mm`, `body_width_mm`, `body_height_mm`, and `pitch_mm` are all hardcoded `null` in `jlcparts-provider.ts` (`buildPackage()`, line ~448). JLC Parts structured attributes carry `Pitch`, `Body Length`, `Body Width`, and similar keys for many component classes. Without these, the draft footprint generation in `draft-generation.ts` has no geometry — every generated footprint draft is dimensionless and unreviewed by necessity. This blocks the entire CAD generation path for JLC-sourced parts.
**Expected outcome**: `pitchMm`, `bodyLengthMm`, `bodyWidthMm`, `bodyHeightMm` populated from JLC Parts `attributes` map for components that carry them. Parsing should be unit-aware (handle `mm`, `mil`, `inch` attribute strings). Null when not present (keep existing fallback).
**Files to inspect or modify**:
- `apps/worker/src/providers/jlcparts-provider.ts` — `buildPackage()` function, `readAttributes()` helper
- `apps/worker/src/providers/jlcparts-provider.test.ts` — add attribute dimension parsing tests
**Tests**:
- Unit tests with attribute maps that include `Pitch`, `Body Length`, `Body Width`, `Body Height`
- Test that attributes with `mil` units are converted to mm
- Test that a component without these attributes still produces valid null values
- `npm test` in `apps/worker`
**Risk**: Medium — data parsing; wrong unit conversion produces bad geometry silently
**Dependencies**: Required before CAD draft generation is useful for JLC parts (P1-7)

---

### P0-4 · Confirm or add readiness summary recomputation after acquisition jobs

**Priority**: P0
**Why it matters**: `part_readiness_summaries` are computed and persisted during acquisition job processing. If the `derivePartProjection()` logic changes — new issue codes, confidence threshold adjustments, new blocker rules — all existing parts silently carry stale summaries. The admin search view filters on `readiness_status`, making stale summaries directly visible as wrong data to operators. Need to confirm the recompute path exists and is triggered correctly after each import.
**Expected outcome**: Verify that `processProviderAcquisitionJobs()` calls the readiness/issue recompute for each successfully imported part. Add a batch `recompute:readiness` worker command for post-logic-change rebuilds. Confirm the `part_readiness_summaries` row for a part is always written or updated, never left as stale from a prior import run.
**Files to inspect or modify**:
- `apps/worker/src/provider-acquisition-jobs.ts` — check if readiness recompute is called post-success
- `apps/worker/src/catalog-repository.ts` — `deriveAndPersistPartProjection()` or equivalent
- `apps/worker/src/index.ts` — add `recompute:readiness` CLI command
- `packages/shared/src/part-readiness.ts` — `derivePartProjection()`
**Tests**:
- After importing a part, assert `part_readiness_summaries` row exists with non-null `last_evaluated_at`
- After changing readiness logic, assert recompute command updates the stored summary
- `npm test` in `apps/worker`, `npm run worker` with a test ingest
**Risk**: Medium — recompute at scale could be slow; batch with configurable size
**Dependencies**: Required for accurate admin filtering and issue queue integrity

---

## P1: High-Impact Improvements

---

### P1-1 · Datasheet enrichment should download and hash the PDF, not just capture URL reference

**Priority**: P1
**Why it matters**: `processDatasheetCaptureJob()` in `provider-enrichment-jobs.ts` creates a `provider_enrichment_jobs` record of type `datasheet_capture` after acquisition succeeds. The job currently stores that a datasheet URL was present in the source record but does not fetch, hash, or store the actual file. This means the `datasheet_revisions` table has `file_asset_id` pointing to an asset with `availability_status: 'referenced'` that never advances to `downloaded` or `validated`. The entire enrichment pipeline produces no tangible improvement to asset trust for any part currently.
**Expected outcome**: `processDatasheetCaptureJob()` fetches the URL, writes the file through the storage client (P0-2), sets `availability_status = 'downloaded'`, computes and stores `file_hash`, updates the asset record. On fetch failure, sets `availability_status = 'failed'` with a clear error code. Updates `parse_confidence` if page count can be determined from PDF metadata.
**Files to inspect or modify**:
- `apps/worker/src/provider-enrichment-jobs.ts` — `processDatasheetCaptureJob()`
- `apps/worker/src/catalog-repository.ts` — `captureReferencedDatasheetEvidenceForPart()`
- `packages/shared/src/types.ts` — `ProviderEnrichmentJobType` (keep `datasheet_capture`)
**Tests**:
- Mock HTTP fetch, assert asset transitions to `downloaded` with correct hash
- Assert failed fetch records `availability_status: 'failed'` and `error_code`
- Assert duplicate enrichment enqueue is rejected (unique constraint on active jobs)
- `npm test` in `apps/worker`
**Risk**: Medium — HTTP failures and large PDFs need timeout/size limits; add them
**Dependencies**: P0-2 (storage backend); blocked by file storage decision

---

### P1-2 · Verify search query uses new GIN indexes efficiently; add EXPLAIN output to test suite

**Priority**: P1
**Why it matters**: Migrations 019–021 added GIN trigram indexes for MPN, description, manufacturer name, package name, and category. Migration 021 added part_id indexes on `part_readiness_summaries` and `part_approvals`. The search query uses `%query%` LIKE patterns, which DO use GIN trigram indexes (for queries ≥ 3 chars). But the search also has two correlated `EXISTS` subqueries — one over `source_records` and one over `assets` — that may not benefit from the trigram index when combined with the part_id correlation. At 600k+ parts these subqueries could dominate query time.
**Expected outcome**: Confirm with `EXPLAIN (ANALYZE, BUFFERS)` that all search paths (free-text, filter-only, combined) use the correct indexes and do not seq-scan large tables. If the `EXISTS` subqueries are slow, replace them with LEFT JOINs or a lateral join. Add a note to the catalog-store test suite that includes one EXPLAIN assertion per query type.
**Files to inspect or modify**:
- `apps/api/src/catalog-store.ts` — `buildSearchSqlFilter()`, specifically the `source_records` EXISTS clause (line ~3637) and the `assets/datasheet_asset` EXISTS clause (line ~3648)
- `infra/postgres/019_catalog_text_search_indexes.sql` — verify migration is applied
- `infra/postgres/021_search_join_indexes.sql` — verify migration is applied
**Tests**:
- Run `EXPLAIN (ANALYZE, BUFFERS)` on the generated search SQL with a representative query; assert `Seq Scan on parts` does not appear for any query with >100k rows
- `npm run migrations` against local DB; run search with `q=LM358`
**Risk**: Low — query-only change; worst case is no improvement (not a regression)
**Dependencies**: Migrations 019 and 021 must be applied first

---

### P1-3 · Source records text search subquery: convert correlated EXISTS to JOIN

**Priority**: P1
**Why it matters**: The catalog search uses:
```sql
OR EXISTS (SELECT 1 FROM source_records sr WHERE sr.part_id = p.id AND lower(sr.provider_part_key) LIKE $param ...)
```
This is a correlated subquery that fires once per candidate part row. PostgreSQL may plan this as a nested-loop hash join on the index, but under high concurrency or with many candidate rows, this becomes a bottleneck. A lateral join or subquery pre-filter would give the planner more freedom.
**Expected outcome**: Refactor the correlated EXISTS clause for `source_records` (and the `assets/datasheet_asset` EXISTS) into a single JOIN or CTE that pre-filters on the trigram index, then joins back to parts. This keeps the SQL readable and gives Postgres better cardinality estimates.
**Files to inspect or modify**:
- `apps/api/src/catalog-store.ts` — `buildSearchSqlFilter()` (line ~3628–3655)
**Tests**:
- Assert search results are identical before/after refactor using the same fixtures
- `npm test` in `apps/api`
**Risk**: Low — pure query refactor with no schema changes
**Dependencies**: P1-2 (run EXPLAIN first to confirm this is actually the bottleneck)

---

### P1-4 · Write test coverage for catalog search page

**Priority**: P1
**Why it matters**: `apps/web/src/app/catalog/page.tsx` is a new page (untracked in git) with no test file. It renders the filter rail, provider lookup panel, import panel, quick-check form, results table, and pagination. Every other page in the web app (`page.tsx`, `parts/[partId]/page.tsx`, `admin/page.tsx`) has a corresponding test. The catalog page is the primary engineer entry point to the platform; missing tests means regressions won't be caught.
**Expected outcome**: `apps/web/src/app/catalog/page.test.ts` covers: empty state (API returns `status: "not_configured"`), results rendered for mocked search response, filter params reflected in rendered filter rail, quick-check shows matched part, quick-check shows `no_match` state, provider lookup panel appears when `looksLikeConcreteProviderLookupQuery()` is true.
**Files to inspect or modify**:
- `apps/web/src/app/catalog/page.tsx` — reference for component structure
- `apps/web/src/app/parts/[partId]/page.test.ts` — use as pattern
- `apps/web/src/app/admin/page.test.ts` — use as pattern
**Tests**:
- `npm test` in `apps/web`
**Risk**: Low — tests only; no production changes
**Dependencies**: None

---

### P1-5 · Add bulk readiness recompute worker command

**Priority**: P1
**Why it matters**: There is no `npm run recompute:readiness` command. When `derivePartProjection()` logic changes — new part issue codes, confidence threshold tuning, new blocker rules — every existing `part_readiness_summaries` row is stale. Operators would need to re-import every part to get fresh summaries. This makes iterating on readiness logic expensive and production deployments dangerous.
**Expected outcome**: New worker command `npm run recompute:readiness` that pages through all parts in `parts` table (by `last_updated_at` or ID range), calls `deriveAndPersistPartProjection()` for each batch, logs progress, and handles failures gracefully (continue on error, log which parts failed). Accepts `--batch-size` and optional `--since` (ISO date) flags.
**Files to inspect or modify**:
- `apps/worker/src/index.ts` — add CLI command registration
- `apps/worker/src/catalog-repository.ts` — add `listPartIdsForRecompute()` paged query
- `packages/shared/src/part-readiness.ts` — confirm `derivePartProjection()` is stateless/reentrant
**Tests**:
- Run with a small fixture DB and assert all readiness rows are updated with a fresh `last_evaluated_at`
**Risk**: Low — read-heavy, idempotent operation
**Dependencies**: P0-4 confirms recompute is wired; this adds the batch interface

---

### P1-6 · Implement duplicate candidate detection algorithm

**Priority**: P1
**Why it matters**: The `duplicate_candidate` issue code exists in `part_issues` and the admin page shows a `duplicates` issue queue. But there is no code that creates `duplicate_candidate` issues. The admin queue for duplicates is always empty for any real import. At 600k+ JLC parts, duplicate imports (same MPN from slightly different category payloads, manufacturer name variants, etc.) will silently accumulate.
**Expected outcome**: A worker job or post-acquisition step that compares newly imported parts against existing catalog entries using (manufacturer_id, mpn) exact match and fuzzy MPN similarity for near-duplicates. Exact-match duplicates (same `manufacturer_id + mpn`, different `id`) are auto-flagged as `duplicate_candidate`. Near-duplicates above a configurable threshold are flagged with lower confidence. Issues are created in `part_issues` with `issue_code: 'duplicate_candidate'` and a `resolution_notes` payload explaining the match evidence.
**Files to inspect or modify**:
- `apps/worker/src/catalog-repository.ts` — add `findDuplicateCandidates()` query using DB unique constraint violations as a signal
- `apps/worker/src/provider-acquisition-jobs.ts` — call duplicate check after successful import
- `packages/shared/src/part-readiness.ts` — confirm `duplicate_candidate` issue code is already in projection logic
**Tests**:
- Import same MPN twice under different IDs; assert `duplicate_candidate` issue created for both
- Verify distinct MPNs produce no duplicate issue
- `npm test` in `apps/worker`
**Risk**: Medium — false positives in fuzzy matching must not auto-merge; flag only
**Dependencies**: None

---

### P1-7 · Surface subcategory in search filter UI

**Priority**: P1
**Why it matters**: The `IMPLEMENTATION_STATUS.md` notes subcategory search as "Planned, not surfaced." The database schema supports `category` (which carries subcategory-style values like `"Resistors / Chip Resistor"`). The search filter already accepts a `category` param. The facets endpoint likely can return distinct category values. Engineers browsing a connector catalog need to filter by subcategory (e.g., "Connectors / USB" vs "Connectors / Board-to-Board") to narrow results efficiently.
**Expected outcome**: The facets response includes a `categories` facet with counts. The catalog search filter rail renders a category multi-select filter alongside the existing readiness/approval/CAD filters. The `category` search param is populated when the user selects a value.
**Files to inspect or modify**:
- `apps/api/src/catalog-store.ts` — `readSearchFacets()` query; add `categories` aggregate
- `packages/shared/src/types.ts` — `SearchFacets` type; add `categories` field
- `apps/web/src/app/catalog/page.tsx` — render category facet filter rail
- `apps/web/src/components/CatalogResultsPresentation.tsx` — if categories are rendered there
**Tests**:
- Facets query returns `categories` array with count > 0 for seeded catalog
- Category filter applied to search returns only matching parts
- `npm test` in `apps/api`, `apps/web`
**Risk**: Low — read-only query change; UI addition only
**Dependencies**: None

---

### P1-8 · JLC Parts: populate `description` with a normalized, engineer-readable string

**Priority**: P1
**Why it matters**: Migration 020 added the `description` column to `parts`. The JLC Parts adapter reads `component.description` from the provider payload (line 557) and persists it. But JLC Parts descriptions are often raw attribute strings like `"100Ω ±1% 0.1W 0402"` — not human-readable descriptions. The `description` field is now in the search query (`lower(p.description) LIKE $param`), so search quality depends on description content. A normalized description that includes manufacturer, value, and key attributes is more useful than a raw attribute dump.
**Expected outcome**: `buildNormalizedDescription()` helper in `jlcparts-provider.ts` that synthesizes a readable string from available fields: `"[category] [MPN] [key_attributes] ([package])"`. Fallback to raw description if synthesis fails. Update `normalizeProviderPart()` to use this helper. The result should be a single-line string ≤ 200 chars that an engineer can scan quickly.
**Files to inspect or modify**:
- `apps/worker/src/providers/jlcparts-provider.ts` — `normalizeProviderPart()`, add `buildNormalizedDescription()`
- `apps/worker/src/providers/jlcparts-provider.test.ts` — add description normalization tests
**Tests**:
- Resistor component produces `"Resistors 100Ω 1% 0.1W (0402)"` style description
- IC component produces `"Linear Regulators TPS7A02DBVR (SOT-23-5)"` style description
- Falls back to raw description when attributes are sparse
- `npm test` in `apps/worker`
**Risk**: Low — additive change; no schema change needed
**Dependencies**: None

---

## P2: Important but Not Urgent

---

### P2-1 · Auto-detect multi-provider source conflicts and create reconciliation records

**Priority**: P2
**Why it matters**: `part_source_reconciliations` and `part_risk_flags` exist. The admin page has a source conflicts issue queue. But there is no code that automatically creates `source_conflict` issues when two providers return different normalized data for the same MPN. Operators never see conflicts because they are never surfaced. As more providers are added, silent data overwriting becomes a real integrity risk.
**Expected outcome**: After acquisition job success, if `source_records` contains >1 row for the same `part_id` from different `provider_id` values, run a comparison of key fields (manufacturer, category, lifecycle_status, package). If any field differs beyond a confidence threshold, create a `source_conflict` issue in `part_issues` and a pending `part_source_reconciliations` row with `resolution_status: 'unreviewed'`.
**Files to inspect or modify**:
- `apps/worker/src/provider-acquisition-jobs.ts` — post-success conflict check
- `apps/worker/src/catalog-repository.ts` — add `detectSourceConflicts()` query
- `packages/shared/src/part-readiness.ts` — confirm `source_conflict` propagates to readiness blockers
**Tests**:
- Import same MPN from two providers with different lifecycle values; assert source_conflict issue created
- `npm test` in `apps/worker`
**Risk**: Medium — false positives if normalization differs between providers; tune threshold
**Dependencies**: Requires at least two providers with overlapping parts (currently local + JLC)

---

### P2-2 · Add extraction signal review UI to admin page

**Priority**: P2
**Why it matters**: `source_extraction_signals` records are created for every imported part (JLC Parts creates 3 per part: package_mechanical_dimensions, pin_table, mechanical_drawing). For JLC Parts, all pin_table and mechanical_drawing signals have `extraction_status: 'not_available'`. Package dimension signals have `extraction_status: 'needs_review'` for parts with known package codes. But the admin page has no queue or UI for reviewing these signals in bulk. Operators cannot see which parts are ready for extraction review or act on them.
**Expected outcome**: A new "Extraction Signals" section in the admin page that shows `needs_review` extraction signals grouped by `signal_type`. Each row shows part MPN, signal type, confidence score, and extraction source. Admin can mark a signal as `reviewed_confirmed` or `reviewed_rejected` and trigger a generation request if confirmed. Linked to the draft generation flow.
**Files to inspect or modify**:
- `apps/web/src/app/admin/page.tsx` — add extraction signals queue section
- `apps/api/src/catalog-store.ts` — add `readExtractionSignalQueue()` query
- `apps/api/src/index.ts` — add `GET /extraction-signals` (admin only) route
**Tests**:
- Admin page renders extraction signal queue for seeded fixtures
- `npm test` in `apps/web`, `apps/api`
**Risk**: Low — read-heavy; no new mutation routes needed initially
**Dependencies**: P0-3 (package dimensions populated makes signals meaningful)

---

### P2-3 · Verify and document readiness projection issue generation for every issue code

**Priority**: P2
**Why it matters**: `packages/shared/src/part-readiness.ts` derives `part_issues` from part state. There are 10 issue codes (`low_confidence_identity`, `pending_approval`, `missing_verified_cad`, `missing_datasheet`, `missing_connector_mate`, `missing_connector_accessories`, `connector_low_confidence`, `lifecycle_risk`, `source_conflict`, `duplicate_candidate`). Some of these (especially `missing_connector_mate` and `missing_connector_accessories`) require connector intelligence data that is rarely present for JLC-imported parts. Ensure each code has at least one end-to-end test path from import → issue creation → admin queue.
**Expected outcome**: A comprehensive test in `apps/worker/src/catalog-repository.test.ts` (or a new `readiness-projection.test.ts`) that exercises each issue code with a minimal fixture that triggers it. Document which issue codes require enrichment data vs. base import data.
**Files to inspect or modify**:
- `packages/shared/src/part-readiness.ts` — confirm all 10 issue code derivation paths
- `apps/worker/src/catalog-repository.test.ts` — add per-issue-code test cases
**Tests**:
- Each of the 10 issue codes is triggered by at least one test fixture
- `npm test` in `packages/shared`, `apps/worker`
**Risk**: Low — test-only work
**Dependencies**: None

---

### P2-4 · Add `GET /parts` facets for connector class and lifecycle status

**Priority**: P2
**Why it matters**: The catalog search filter rail in `apps/web/src/app/catalog/page.tsx` renders `connectorClass` and `lifecycleStatus` filters. But the `SearchFacets` response may not include counts for these dimensions, meaning the filter UI cannot show users how many results each option would return. Engineers picking a lifecycle filter benefit from seeing "active (12,400) / not_recommended (340) / obsolete (2,100)."
**Expected outcome**: `readSearchFacets()` in `catalog-store.ts` returns `connectorClass` and `lifecycleStatus` facet counts in addition to existing facets. The catalog page renders counts next to each filter option.
**Files to inspect or modify**:
- `apps/api/src/catalog-store.ts` — `readSearchFacets()` SQL query
- `packages/shared/src/types.ts` — `SearchFacets` type
- `apps/web/src/app/catalog/page.tsx` — render facet counts
**Tests**:
- Facets response includes `connectorClass` and `lifecycleStatus` with non-zero counts for seeded data
- `npm test` in `apps/api`
**Risk**: Low — additive query change
**Dependencies**: None

---

### P2-5 · Part detail page: link part issues to actionable admin workflows

**Priority**: P2
**Why it matters**: The part detail page renders a readiness summary and issue list. Each issue has a code (`missing_verified_cad`, `pending_approval`, etc.) but no inline action link. Engineers and operators must manually navigate to the admin page and find the same part to take action. A direct link from each issue on the detail page to the corresponding admin workflow (e.g., "Go to review queue," "Submit for approval," "Request CAD generation") would reduce the review cycle significantly.
**Expected outcome**: Each `PartIssue` rendered on the detail page includes a contextual action link or button. For `missing_verified_cad`: link to generation request flow. For `pending_approval`: link to approval workflow. For `missing_datasheet`: show the import intake form. For `duplicate_candidate`: link to admin reconciliation view.
**Files to inspect or modify**:
- `apps/web/src/app/parts/[partId]/page.tsx` — issue rendering section
- `apps/web/src/lib/detail-view-model.ts` — add `getIssueActionLink()` helper
**Tests**:
- `lib/detail-view-model.test.ts` — test `getIssueActionLink()` for each issue code
- `npm test` in `apps/web`
**Risk**: Low — UI-only, no API changes
**Dependencies**: None

---

### P2-6 · Implement compare page (hidden in nav; routes and data layer needed)

**Priority**: P2
**Why it matters**: The compare page is intentionally hidden in nav and marked as not implemented in `IMPLEMENTATION_STATUS.md`. Comparing two or more parts side-by-side (specs, lifecycle, assets, CAD readiness, pricing) is a high-value engineer workflow. A minimal static compare (no live filters) would already be useful.
**Expected outcome**: `GET /compare?parts=id1,id2,id3` renders a table comparing MPN, manufacturer, package, lifecycle, key metrics, asset availability, CAD readiness, and datasheet links for up to 4 parts. Parts are fetched via `GET /parts/:id` for each ID. No server-side aggregation needed.
**Files to inspect or modify**:
- `apps/web/src/app/compare/` — create new page
- `apps/web/src/components/AppNavigation.tsx` — unhide compare nav link
- `apps/api/src/index.ts` — no new endpoints needed; uses existing detail route
**Tests**:
- Compare page renders for two fixture part IDs
- `npm test` in `apps/web`
**Risk**: Low — new page; isolated from existing flows
**Dependencies**: P0-1 (file serving useful for compare page asset links)

---

### P2-7 · Add API rate limiting

**Priority**: P2
**Why it matters**: The API has no rate limiting. A single client can flood `GET /parts` with concurrent search requests and generate thousands of DB connections per second. At 600k+ parts, even index-hitting queries use resources. No rate limiting means a single misconfigured client can degrade the catalog for everyone.
**Expected outcome**: Add per-IP rate limiting middleware before route dispatch in `apps/api/src/index.ts`. Reasonable defaults: 60 requests/minute for search, 120/min for detail reads, 10/min for write operations (acquisition, reviews, promotions). Use an in-memory sliding window (no Redis required for initial version). Return `HTTP 429` with `Retry-After` header on exceed.
**Files to inspect or modify**:
- `apps/api/src/index.ts` — add rate limiter middleware
**Tests**:
- Assert 429 returned after exceeding search limit in rapid succession
- Assert write routes have tighter limits than read routes
- `npm test` in `apps/api`
**Risk**: Low — purely additive middleware
**Dependencies**: None

---

### P2-8 · Provider enrichment: extend `datasheet_capture` to set `parse_confidence` from PDF metadata

**Priority**: P2
**Why it matters**: `datasheet_revisions.parse_confidence` is set to `0` for all JLC-imported parts (line 617 of `jlcparts-provider.ts`). After the enrichment job downloads the PDF (P1-4), it should attempt to read the PDF page count and use it to improve `parse_confidence`. Even just knowing "this is a 24-page datasheet, not a 1-page product brief" improves the quality signal for downstream CAD extraction.
**Expected outcome**: After successful PDF fetch, update `datasheet_revisions.parse_confidence` from `0` to a value derived from page count (e.g., 1-page = 0.3, 2-10 pages = 0.5, >10 pages = 0.8). Update `page_count` column. No PDF parsing needed; just PDF metadata (first-page byte count, stream headers).
**Files to inspect or modify**:
- `apps/worker/src/provider-enrichment-jobs.ts` — `processDatasheetCaptureJob()`
- `apps/worker/src/catalog-repository.ts` — `captureReferencedDatasheetEvidenceForPart()`
**Tests**:
- Mock PDF fetch returning a 24-page document; assert `parse_confidence` and `page_count` updated
- `npm test` in `apps/worker`
**Risk**: Low — read-only PDF header parsing; no schema changes
**Dependencies**: P1-1 (datasheet PDF download must happen first)

---

## P3: Polish and Future Enhancements

---

### P3-1 · Draft generation: add 3D model generation path

**Priority**: P3
**Why it matters**: `draft-generation.ts` handles `footprint` and `symbol` targets only (`DraftableTarget = Extract<GenerationTargetAssetType, "footprint" | "symbol">`). The `three_d_model` target type is in the type system and `generation_requests` can accept it, but the worker silently ignores it. Engineers requesting 3D models get no feedback that their request is unprocessed.
**Expected outcome**: Either: (a) Add a basic 3D model generation stub that creates a placeholder asset with `review_status: 'review_required'` and a clear note about generation limitations, so the request loop closes. Or (b) Return `not_requestable` reason `"3d_model_generation_not_yet_supported"` from the generation request API for this target type, so the UI surfaces a clear message instead of silently accepting.
**Files to inspect or modify**:
- `apps/api/src/catalog-store.ts` — `createGenerationRequest()` — add requestability gate for `three_d_model`
- `apps/worker/src/draft-generation.ts` — add or stub 3D model path
**Tests**:
- `POST /parts/:id/generation-requests` with `targetAssetType: 'three_d_model'` returns `not_requestable`
- `npm test` in `apps/api`, `apps/worker`
**Risk**: Low — additive change or honest rejection
**Dependencies**: None

---

### P3-2 · Automate asset file integrity validation after download

**Priority**: P3
**Why it matters**: `asset_validation_records` supports `validation_type: 'file_integrity'`. After a file is downloaded (P1-1), it should be hash-verified against `file_hash` and validated for format correctness (PDF header check for datasheets, KiCad/Eagle format check for CAD files). Currently, validation is entirely manual (review action in admin page). No automated validation runs after download.
**Expected outcome**: A post-download hook in the enrichment job pipeline that runs `file_integrity` validation immediately after download succeeds. Creates an `asset_validation_records` row with `validation_status: 'passed'` or `'failed'`. Updates `assets.validation_status` from `'not_validated'` to `'verified'` or `'invalid'` accordingly.
**Files to inspect or modify**:
- `apps/worker/src/provider-enrichment-jobs.ts` — add `validateDownloadedAsset()` step
- `apps/worker/src/catalog-repository.ts` — add `persistAssetValidationRecord()`
**Tests**:
- Mock downloaded file with correct hash; assert validation_records row with `passed`
- Mock corrupted file; assert `failed` and asset `availability_status` set to `failed`
**Risk**: Low — additive pipeline step; failures are surfaced, not silent
**Dependencies**: P1-1 (must download before validating), P0-2 (storage backend)

---

### P3-3 · Role-based access control beyond admin flag

**Priority**: P3
**Why it matters**: All admin-protected routes check only for a single admin identity (likely via header or env var). There is no distinction between read-only reviewer, review + promote permissions, and full admin (delete, merge, bulk import). As the team grows, a reviewer accidentally promoting an unvalidated asset to `verified_for_export` is a real risk.
**Expected outcome**: Define at least 3 roles: `reader`, `reviewer` (can submit reviews, cannot promote), `admin` (full access). Middleware reads role from auth header or session. Routes check for minimum required role. No external auth system needed initially — an environment-variable-based role map is sufficient.
**Files to inspect or modify**:
- `apps/api/src/index.ts` — route-level role checks
**Tests**:
- `reviewer` role cannot call `POST /parts/:id/asset-promotions`
- `admin` role can call all routes
**Risk**: Low — additive auth layer
**Dependencies**: None

---

### P3-4 · Audit log for all state-mutating actions

**Priority**: P3
**Why it matters**: `asset_promotion_audits` tracks promotions. `review_records` tracks reviews. But issue workflow updates (`POST /parts/:id/issues/:code/workflow`), source reconciliation (`POST /parts/:id/source-reconciliation`), and generation requests (`POST /parts/:id/generation-requests`) have no audit trail. There is no way to see who resolved a source conflict or who dismissed a duplicate candidate issue.
**Expected outcome**: A generic `catalog_audit_events` table (part_id, action_type, actor, payload JSONB, created_at) that logs all mutating API actions. Routes write to this table after successful DB mutations. Admin page gains a read-only audit log tab.
**Files to inspect or modify**:
- `infra/postgres/` — new migration for `catalog_audit_events`
- `apps/api/src/index.ts` — post-mutation logging in all write routes
- `apps/api/src/catalog-store.ts` — add `logAuditEvent()` helper
**Tests**:
- After each mutating action, assert one audit row exists with correct `action_type` and `actor`
**Risk**: Low — additive table; no existing behavior changes
**Dependencies**: P3-3 (audit log is more useful with named actors)

---

### P3-5 · Real-time or scheduled JLC Parts catalog sync

**Priority**: P3
**Why it matters**: JLC Parts data is fetched from a static snapshot at `https://yaqwsx.github.io/jlcparts/` with a 5-minute cache TTL. This is a community-maintained mirror, not a live API. Parts go EOL, new parts appear, prices change. There is no scheduled worker that re-syncs the catalog periodically to pick up new parts or lifecycle changes.
**Expected outcome**: A cron-style worker command (or scheduled CI job) that: (1) re-fetches the JLC Parts index, (2) compares against `source_records.source_last_seen_at` to identify new and potentially obsolete parts, (3) enqueues new parts for acquisition, (4) flags parts not seen in the latest sync as candidates for lifecycle review.
**Files to inspect or modify**:
- `apps/worker/src/index.ts` — add `sync:jlcparts` command
- `apps/worker/src/provider-acquisition-jobs.ts` — add "last seen" freshness check
- `apps/worker/src/providers/jlcparts-provider.ts` — expose sync metadata
**Tests**:
- Simulate a catalog with 3 known parts; mock sync with 2 of those + 1 new; assert 1 new acquisition job enqueued and 1 not-seen flag created
**Risk**: Medium — risk of mass re-enqueue on cache miss; add guard against full re-ingest on each sync
**Dependencies**: P0-4 (readiness recompute needed to handle lifecycle flag changes at scale)

---

### P3-6 · Manufacturer alias normalization: improve fuzzy matching

**Priority**: P3
**Why it matters**: `manufacturers.aliases` stores alternate names (e.g., `["TE", "AMP", "Tyco"]` for TE Connectivity). But the JLC Parts provider derives manufacturer IDs by slugifying the raw manufacturer name string from the payload. If JLC uses "TE Connectivity" and a local fixture uses "TE", they produce different `manufacturer_id` values, meaning parts from the same maker appear as different manufacturers in the catalog.
**Expected outcome**: A manufacturer normalization pass during import that checks the incoming manufacturer name against existing `manufacturers.name` and `manufacturers.aliases` before creating a new record. If a match is found, use the existing `manufacturer_id` instead of creating a duplicate.
**Files to inspect or modify**:
- `apps/worker/src/catalog-repository.ts` — `upsertManufacturer()` — add alias-based lookup
- `apps/worker/src/providers/jlcparts-provider.ts` — `normalizeManufacturerName()` — confirm alias candidates
- `packages/shared/src/normalization.ts` — if manufacturer normalization helpers exist there
**Tests**:
- Import "TE Connectivity" part; then import "TE" part; assert both resolve to same manufacturer_id
- `npm test` in `apps/worker`
**Risk**: Medium — incorrect matching merges manufacturers; require high-confidence match (exact alias match only, not fuzzy) to start
**Dependencies**: None

---

### P3-7 · `npm run operations:worker` diagnostic improvements

**Priority**: P3
**Why it matters**: `npm run operations:worker` shows worker operational diagnostics. The output currently covers acquisition and enrichment job counts. It should also surface: stale readiness summaries (evaluated >7 days ago), parts with `missing` assets still at `referenced`, extraction signal needs_review counts by type, and parts with no acquisition job at all.
**Expected outcome**: The operations command outputs a structured health report with counts for each operational concern. This replaces the need to run ad-hoc SQL queries to understand catalog health.
**Files to inspect or modify**:
- `apps/worker/src/index.ts` — `operations:worker` command handler
- `apps/worker/src/catalog-repository.ts` — add diagnostic query functions
**Tests**:
- Operational report includes all expected sections and returns correct counts for fixture DB
**Risk**: Low — read-only diagnostic; no mutations
**Dependencies**: None

---

## Cross-Cutting Notes

### On seed data
There is no seed-data fallback in the API query path. `CatalogStoreError` propagates explicitly rather than silently returning seed data. This is correct behavior — do not add a seed fallback to API routes.

### On the existing test suite
38 test files exist across all packages. Core logic (readiness projection, asset state machine, review workflow, search) is well covered. The main gaps are: catalog page tests (P1-4), end-to-end flow tests (search → import → review → promote), and per-issue-code readiness projection tests (P2-3).

### On the admin page
The admin page correctly renders the review, promotion, import, and issue queues. The main usability gap is the lack of an extraction signal queue (P2-2) and direct action links from the detail page (P2-5).

### On the generation workflow
`draft-generation.ts` is wired to `generateDraftAssetsForPendingRequests()` and processes pending `generation_requests` rows. It creates `assets` with `provenance: 'generated'`, `review_status: 'review_required'`, `export_status: 'not_exportable'`. This is the correct trust posture. The gap is that 3D model requests are accepted but silently unprocessed (P3-1).

### On migrations
All 21 migrations are incremental and additive. Migrations 019–021 (GIN indexes, description column, join indexes) were added in the current branch and must be applied before the new search capabilities are effective. Run `npm run migrations` after checkout.
