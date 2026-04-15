/**
 * File header: Tests DB-backed API reads for a real-provider canonical import shape.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { buildPartDetailResponse } from "./detail-response";
import { readPartDetailRecordsFromDatabase, readPartSearchRecordsFromDatabase, setCatalogStorePoolForTests } from "./catalog-store";
import type { CatalogQueryTiming } from "./catalog-store";
import type { Pool, PoolClient } from "pg";

/** TestPool is the pg-mem pool shape used by catalog-store tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it from catalog-store. */
  end: () => Promise<void>;
};

/**
 * Verifies imported provider-neutral rows are visible through DB-backed search and detail reads.
 */
test("DB-backed search and detail can read a jlcparts imported metadata record", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    const searchResult = await readPartSearchRecordsFromDatabase({ query: "RC-02W300JT" });
    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");

    assert.equal(searchResult.status, "available");
    assert.equal(detailResult.status, "available");

    if (searchResult.status !== "available" || detailResult.status !== "available") {
      throw new Error("expected DB-backed records");
    }

    assert.equal(searchResult.pagination.totalRecords, 1);
    assert.equal(searchResult.pagination.page, 1);

    const searchRecord = searchResult.records.find((record) => record.part.id === "part-jlcparts-c1091");
    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(searchRecord, "expected imported record in DB-backed search");
    assert.ok(detailRecord, "expected imported record in DB-backed detail");
    assert.equal(searchRecord.manufacturer.name, "Guangdong Fenghua Advanced Tech");
    assert.equal(searchRecord.sources[0]?.providerId, "jlcparts");
    assert.equal(searchRecord.sources[0]?.importStatus, "imported");
    assert.equal(searchRecord.sources[0]?.sourceLastImportedAt, "2026-04-12T06:57:40.000Z");
    assert.equal(searchRecord.extractionSignals.find((signal) => signal.signalType === "package_mechanical_dimensions")?.extractionStatus, "needs_review");
    assert.equal(searchRecord.metrics.length, 0);
    assert.equal(detailRecord.metrics.find((metric) => metric.metricKey === "resistance")?.metricValue, 30);

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records);
    const datasheetGroup = detailResponse.assetGroups.find((group) => group.assetType === "datasheet");

    assert.equal(datasheetGroup?.bestAsset?.availabilityStatus, "referenced");
    assert.equal(datasheetGroup?.bestAsset?.exportStatus, "not_exportable");
    assert.equal(detailResponse.bundleReadiness.state, "references_only");
    assert.match(detailResponse.bundleReadiness.reason, /no file-backed CAD assets/u);
    assert.equal(detailResponse.generationOptions.find((option) => option.targetAssetType === "symbol")?.canRequest, false);
    assert.match(detailResponse.generationOptions.find((option) => option.targetAssetType === "footprint")?.reason ?? "", /Package\/mechanical dimensions extraction/u);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies SQL-backed search applies filters, pagination, stable sorting, and query timings.
 */
test("DB-backed search filters, sorts, and paginates in SQL", async () => {
  const pool = createProviderImportPool();
  const timings: CatalogQueryTiming[] = [];

  try {
    setCatalogStorePoolForTests(pool);
    await seedSearchRows(pool);

    const firstPage = await readPartSearchRecordsFromDatabase({ page: 1, pageSize: 2, sort: "mpn_asc" }, { onQueryTiming: (timing) => timings.push(timing) });
    const secondPage = await readPartSearchRecordsFromDatabase({ page: 2, pageSize: 2, sort: "mpn_asc" });
    const manufacturerFiltered = await readPartSearchRecordsFromDatabase({ manufacturerId: "mfr-search-alpha", sort: "mpn_asc" });
    const lifecycleFiltered = await readPartSearchRecordsFromDatabase({ lifecycleStatus: "obsolete", sort: "mpn_asc" });
    const cadAvailable = await readPartSearchRecordsFromDatabase({ cadAvailability: "available", sort: "mpn_asc" });
    const trustSorted = await readPartSearchRecordsFromDatabase({ pageSize: 2, sort: "trust_desc" });

    assert.equal(firstPage.status, "available");
    assert.equal(secondPage.status, "available");
    assert.equal(manufacturerFiltered.status, "available");
    assert.equal(lifecycleFiltered.status, "available");
    assert.equal(cadAvailable.status, "available");
    assert.equal(trustSorted.status, "available");

    if (firstPage.status !== "available" || secondPage.status !== "available" || manufacturerFiltered.status !== "available" || lifecycleFiltered.status !== "available" || cadAvailable.status !== "available" || trustSorted.status !== "available") {
      throw new Error("expected DB-backed search records");
    }

    assert.deepEqual(firstPage.records.map((record) => record.part.mpn), ["AAA-100", "BBB-200"]);
    assert.deepEqual(secondPage.records.map((record) => record.part.mpn), ["CCC-300", "RC-02W300JT"]);
    assert.equal(firstPage.pagination.totalRecords, 4);
    assert.equal(firstPage.pagination.totalPages, 2);
    assert.deepEqual(manufacturerFiltered.records.map((record) => record.part.mpn), ["AAA-100", "CCC-300"]);
    assert.deepEqual(lifecycleFiltered.records.map((record) => record.part.mpn), ["BBB-200"]);
    assert.deepEqual(cadAvailable.records.map((record) => record.part.mpn), ["AAA-100"]);
    assert.deepEqual(trustSorted.records.map((record) => record.part.mpn), ["BBB-200", "CCC-300"]);
    assert.equal(firstPage.records[0]?.metrics.length, 0);
    assert.equal(firstPage.records[0]?.similarParts.length, 0);
    assert.equal(firstPage.records[0]?.assets[0]?.exportStatus, "verified_for_export");
    assert.ok(timings.some((timing) => timing.name === "search_count" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_part_ids" && timing.status === "ok"));
    assert.equal(timings.some((timing) => timing.name === "metrics"), false);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies generated draft assets appear in DB-backed detail without enabling export.
 */
test("DB-backed detail exposes generated draft assets as review-required and not exportable", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);
    await seedGeneratedDraftRows(pool);

    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");

    assert.equal(detailResult.status, "available");

    if (detailResult.status !== "available") {
      throw new Error("expected DB-backed detail records");
    }

    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(detailRecord, "expected imported record in DB-backed detail");

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records);
    const symbolGroup = detailResponse.assetGroups.find((group) => group.assetType === "symbol");
    const workflow = detailResponse.generationOptions.find((option) => option.targetAssetType === "symbol")?.workflow;

    assert.equal(symbolGroup?.bestAsset?.provenance, "generated");
    assert.equal(symbolGroup?.bestAsset?.reviewStatus, "review_required");
    assert.equal(symbolGroup?.bestAsset?.exportStatus, "not_exportable");
    assert.equal(workflow?.generationStatus, "review_required");
    assert.equal(workflow?.outputAssetId, "asset-draft-jlcparts-c1091-symbol");
    assert.equal(detailResponse.assetValidationSummaries.find((summary) => summary.assetId === "asset-draft-jlcparts-c1091-symbol")?.latestValidation?.validationType, "symbol_pin_mapping");
    assert.equal(detailResponse.assetPromotionSummaries.find((summary) => summary.assetId === "asset-draft-jlcparts-c1091-symbol")?.latestPromotion?.promotionOutcome, "denied");
    assert.match(detailResponse.assetPromotionSummaries.find((summary) => summary.assetId === "asset-draft-jlcparts-c1091-symbol")?.blockerReasons.join(" ") ?? "", /approved review/u);
    assert.equal(detailResponse.bundleReadiness.exportActions.every((action) => !action.available), true);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies detail reads hydrate relationship targets as summaries instead of full asset/workflow records.
 */
test("DB-backed detail uses lightweight related-part summary reads", async () => {
  const pool = createRelatedSummaryCountingPool();

  try {
    setCatalogStorePoolForTests(pool as unknown as Pool);

    const detailResult = await readPartDetailRecordsFromDatabase("part-main");

    assert.equal(detailResult.status, "available");

    if (detailResult.status !== "available") {
      throw new Error("expected DB-backed detail records");
    }

    assert.deepEqual(detailResult.records.map((record) => record.part.id), ["part-main", "part-mate"]);
    assert.equal(pool.queryTexts.filter((text) => text.includes("FROM assets")).length, 1);
    assert.equal(pool.queryTexts.filter((text) => text.includes("FROM generation_workflows")).length, 1);
    assert.deepEqual(pool.partScopes, [["part-main"], ["part-mate"]]);
  } finally {
    setCatalogStorePoolForTests(null);
  }
});

/**
 * Creates an in-memory Postgres-compatible pool seeded with one imported provider record.
 */
function createProviderImportPool(): TestPool {
  const db = newDb();

  db.public.none(buildMinimalCatalogSchemaSql());
  db.public.none(buildProviderImportRowsSql());

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Creates a fake pool that records which scoped queries the detail path executes.
 */
function createRelatedSummaryCountingPool() {
  const queryTexts: string[] = [];
  const partScopes: string[][] = [];

  return {
    partScopes,
    queryTexts,
    async query(text: string, values?: unknown[]) {
      queryTexts.push(text);

      if (text.includes("FROM parts")) {
        const scope = Array.isArray(values?.[0]) ? (values?.[0] as string[]) : [];

        partScopes.push(scope);

        return {
          rows: scope.map((partId) => (partId === "part-main" ? buildCountingPartRow("part-main", "MAIN-1") : buildCountingPartRow("part-mate", "MATE-1")))
        };
      }

      if (text.includes("FROM mate_relations")) {
        return {
          rows: [
            {
              confidence_score: "0.9",
              id: "mate-main",
              mate_part_id: "part-mate",
              notes: null,
              part_id: "part-main",
              relationship_type: "best_mate",
              source_revision_id: "dsr-main"
            }
          ]
        };
      }

      return { rows: [] };
    }
  };
}

/**
 * Builds one joined part row for the related-summary detail optimization test.
 */
function buildCountingPartRow(partId: string, mpn: string) {
  return {
    body_height_mm: null,
    body_length_mm: null,
    body_width_mm: null,
    category: "Connector",
    connector_family_description: null,
    connector_family_id: null,
    connector_family_name: null,
    connector_family_series: null,
    lifecycle_status: "active",
    manufacturer_aliases: [],
    manufacturer_id: "mfr-counting",
    manufacturer_name: "Counting Manufacturer",
    manufacturer_website: null,
    mpn,
    package_id: "pkg-counting",
    package_name: "Counting Package",
    part_id: partId,
    part_last_updated_at: "2026-04-15T00:00:00.000Z",
    pin_count: 2,
    pitch_mm: null,
    trust_score: "0.7"
  };
}

/**
 * Builds the minimum canonical schema needed by catalog-store's DB-backed read queries.
 */
function buildMinimalCatalogSchemaSql(): string {
  return `
    CREATE TABLE manufacturers (id TEXT, name TEXT, aliases TEXT[], website TEXT);
    CREATE TABLE packages (id TEXT, package_name TEXT, pin_count INTEGER, pitch_mm NUMERIC, body_length_mm NUMERIC, body_width_mm NUMERIC, body_height_mm NUMERIC);
    CREATE TABLE connector_families (id TEXT, name TEXT, series TEXT, description TEXT);
    CREATE TABLE parts (id TEXT, mpn TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_records (id TEXT, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_extraction_signals (id TEXT, part_id TEXT, source_record_id TEXT, datasheet_revision_id TEXT, asset_id TEXT, signal_type TEXT, extraction_status TEXT, confidence_score NUMERIC, extraction_source TEXT, notes TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE assets (id TEXT, part_id TEXT, asset_type TEXT, file_format TEXT, storage_key TEXT, file_hash TEXT, provider_id TEXT, license_mode TEXT, provenance TEXT, availability_status TEXT, review_status TEXT, export_status TEXT, asset_status TEXT, generation_method TEXT, generation_source_asset_id TEXT, validation_status TEXT, preview_status TEXT, asset_state TEXT, source_url TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE datasheet_revisions (id TEXT, part_id TEXT, revision_label TEXT, revision_date DATE, page_count INTEGER, file_asset_id TEXT, parse_confidence NUMERIC, pin_table_status TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_metrics (id TEXT, part_id TEXT, metric_key TEXT, metric_value NUMERIC, unit TEXT, min_value NUMERIC, max_value NUMERIC, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE mate_relations (id TEXT, part_id TEXT, mate_part_id TEXT, relationship_type TEXT, confidence_score NUMERIC, source_revision_id TEXT, notes TEXT);
    CREATE TABLE accessory_requirements (id TEXT, part_id TEXT, accessory_part_id TEXT, relationship_type TEXT, confidence_score NUMERIC, source_revision_id TEXT, notes TEXT);
    CREATE TABLE cable_compatibilities (id TEXT, part_id TEXT, cable_part_id TEXT, relationship_type TEXT, confidence_score NUMERIC, source_revision_id TEXT, notes TEXT);
    CREATE TABLE similar_part_relations (id TEXT, part_id TEXT, similar_part_id TEXT, confidence_score NUMERIC, reason TEXT);
    CREATE TABLE companion_recommendations (id TEXT, part_id TEXT, companion_part_id TEXT, confidence_score NUMERIC, usage_context TEXT);
    CREATE TABLE generation_workflows (id TEXT, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, generation_status TEXT, confidence_score NUMERIC, output_asset_id TEXT);
    CREATE TABLE generation_requests (id TEXT, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, request_status TEXT, requested_at TIMESTAMPTZ, requested_by TEXT, workflow_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE review_records (id TEXT, part_id TEXT, target_type TEXT, asset_id TEXT, generation_workflow_id TEXT, outcome TEXT, reviewer TEXT, notes TEXT, reviewed_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_validation_records (id TEXT, part_id TEXT, asset_id TEXT, validation_status TEXT, validation_type TEXT, validation_notes TEXT, validated_at TIMESTAMPTZ, validator TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_promotion_audits (id TEXT, part_id TEXT, asset_id TEXT, prior_export_status TEXT, new_export_status TEXT, promotion_outcome TEXT, blocker_reasons TEXT[], validation_record_id TEXT, actor TEXT, created_at TIMESTAMPTZ);
  `;
}

/**
 * Builds canonical rows for the real C1091/RC-02W300JT jlcparts import shape.
 */
function buildProviderImportRowsSql(): string {
  return `
    INSERT INTO manufacturers VALUES ('mfr-jlcparts-guangdong-fenghua-advanced-tech', 'Guangdong Fenghua Advanced Tech', '{"FH","FH(Guangdong Fenghua Advanced Tech)"}', NULL);
    INSERT INTO packages VALUES ('pkg-jlcparts-0402', '0402', 2, NULL, NULL, NULL, NULL);
    INSERT INTO parts VALUES ('part-jlcparts-c1091', 'RC-02W300JT', 'mfr-jlcparts-guangdong-fenghua-advanced-tech', 'Resistors / Chip Resistor - Surface Mount', 'active', 'pkg-jlcparts-0402', NULL, 0.62, '2026-04-12T06:57:40.000Z');
    INSERT INTO source_records VALUES ('source-jlcparts-c1091', 'jlcparts', 'C1091', 'part-jlcparts-c1091', 'https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html', '2026-04-12T06:57:40.000Z', '{"component":{"lcsc":"C1091","mfr":"RC-02W300JT"},"indexCreatedAt":"2026-04-12T06:57:40+00:00"}'::jsonb, '2026-04-12T06:57:40.000Z', '2026-04-12T06:57:40.000Z', '2026-04-12T06:57:40.000Z', 'imported', NULL, '2026-04-12T06:57:40.000Z');
    INSERT INTO assets VALUES ('asset-jlcparts-c1091-datasheet', 'part-jlcparts-c1091', 'datasheet', 'pdf', NULL, NULL, 'jlcparts', 'metadata_only', 'trusted_external', 'referenced', 'not_reviewed', 'not_exportable', 'referenced', NULL, NULL, 'not_validated', 'not_available', 'referenced', 'https://www.lcsc.com/datasheet/lcsc_datasheet_2411121005_FH--Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.pdf', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO datasheet_revisions VALUES ('dsr-jlcparts-c1091', 'part-jlcparts-c1091', 'Provider datasheet reference', NULL, NULL, 'asset-jlcparts-c1091-datasheet', 0, 'not_available', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO source_extraction_signals VALUES ('sig-jlcparts-c1091-package', 'part-jlcparts-c1091', 'source-jlcparts-c1091', 'dsr-jlcparts-c1091', 'asset-jlcparts-c1091-datasheet', 'package_mechanical_dimensions', 'needs_review', 0.35, 'provider_structured_metadata', 'Only provider package code and pin count were mapped; body and pitch dimensions were not extracted.', '2026-04-12T06:57:40.000Z');
    INSERT INTO source_extraction_signals VALUES ('sig-jlcparts-c1091-pin-table', 'part-jlcparts-c1091', 'source-jlcparts-c1091', 'dsr-jlcparts-c1091', 'asset-jlcparts-c1091-datasheet', 'pin_table', 'not_available', 0, 'provider_structured_metadata', 'No reviewed pin table was extracted from the structured provider metadata.', '2026-04-12T06:57:40.000Z');
    INSERT INTO part_metrics VALUES ('metric-jlcparts-c1091-resistance-1', 'part-jlcparts-c1091', 'resistance', 30, 'ohm', NULL, NULL, 0.72, 'dsr-jlcparts-c1091', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
  `;
}

/**
 * Seeds deterministic rows that exercise SQL-backed search filters and pagination.
 */
async function seedSearchRows(pool: TestPool): Promise<void> {
  const client = await pool.connect();

  try {
    await insertSearchIdentityRows(client);
    await insertSearchAssetRows(client);
  } finally {
    client.release();
  }
}

/**
 * Inserts identity rows with deliberate MPN and trust-score ordering ties.
 */
async function insertSearchIdentityRows(client: PoolClient): Promise<void> {
  await client.query(`
    INSERT INTO manufacturers VALUES ('mfr-search-alpha', 'Alpha Components', '{"Alpha"}', NULL);
    INSERT INTO manufacturers VALUES ('mfr-search-beta', 'Beta Components', '{"Beta"}', NULL);
    INSERT INTO packages VALUES ('pkg-search-sot23', 'SOT-23', 3, NULL, NULL, NULL, NULL);
    INSERT INTO packages VALUES ('pkg-search-qfn', 'QFN-16', 16, 0.5, 3, 3, 0.85);
    INSERT INTO parts VALUES ('part-search-a', 'AAA-100', 'mfr-search-alpha', 'Connector', 'active', 'pkg-search-sot23', NULL, 0.7, '2026-04-10T00:00:00.000Z');
    INSERT INTO parts VALUES ('part-search-b', 'BBB-200', 'mfr-search-beta', 'Power', 'obsolete', 'pkg-search-qfn', NULL, 0.95, '2026-04-11T00:00:00.000Z');
    INSERT INTO parts VALUES ('part-search-c', 'CCC-300', 'mfr-search-alpha', 'Connector', 'active', 'pkg-search-qfn', NULL, 0.95, '2026-04-12T00:00:00.000Z');
  `);
}

/**
 * Inserts one verified CAD asset and one non-exportable draft to test CAD truth filters.
 */
async function insertSearchAssetRows(client: PoolClient): Promise<void> {
  await client.query(`
    INSERT INTO assets VALUES ('asset-search-a-footprint', 'part-search-a', 'footprint', 'kicad_mod', 'cad/aaa-100.kicad_mod', 'sha256:aaa-footprint', NULL, 'redistribution_allowed', 'manual_internal', 'validated', 'approved', 'verified_for_export', 'verified_for_export', NULL, NULL, 'verified', 'ready', 'validated', NULL, NULL, '2026-04-12T00:00:00.000Z');
    INSERT INTO assets VALUES ('asset-search-c-symbol-draft', 'part-search-c', 'symbol', 'kicad_sym', 'generated/drafts/ccc-300.kicad_sym', 'sha256:ccc-symbol', NULL, 'redistribution_allowed', 'generated', 'downloaded', 'review_required', 'not_exportable', 'downloaded', 'draft_symbol_from_extraction_signal', NULL, 'needs_review', 'pending', 'downloaded', NULL, NULL, '2026-04-12T00:00:00.000Z');
  `);
}

/**
 * Seeds a generated symbol draft that mimics the worker Phase 5B output truth fields.
 */
async function seedGeneratedDraftRows(pool: TestPool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(
      `
        INSERT INTO assets VALUES (
          'asset-draft-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'symbol',
          'kicad_sym',
          'generated/drafts/part-jlcparts-c1091/symbol.kicad_sym',
          'sha256:generated-draft',
          NULL,
          'redistribution_allowed',
          'generated',
          'downloaded',
          'review_required',
          'not_exportable',
          'downloaded',
          'draft_symbol_from_extraction_signal',
          'asset-jlcparts-c1091-datasheet',
          'needs_review',
          'pending',
          'downloaded',
          NULL,
          'source-jlcparts-c1091',
          '2026-04-15T00:00:00.000Z'
        )
      `
    );
    await client.query(
      `
        INSERT INTO generation_workflows VALUES (
          'gen-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'symbol',
          'dsr-jlcparts-c1091',
          'asset-jlcparts-c1091-datasheet',
          'review_required',
          0.72,
          'asset-draft-jlcparts-c1091-symbol'
        )
      `
    );
    await client.query(
      `
        INSERT INTO generation_requests VALUES (
          'request-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'symbol',
          'dsr-jlcparts-c1091',
          'asset-jlcparts-c1091-datasheet',
          'review_required',
          '2026-04-15T00:00:00.000Z',
          'local-dev',
          'gen-jlcparts-c1091-symbol',
          '2026-04-15T00:00:00.000Z'
        )
      `
    );
    await client.query(
      `
        INSERT INTO asset_validation_records VALUES (
          'validation-draft-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'asset-draft-jlcparts-c1091-symbol',
          'verified',
          'symbol_pin_mapping',
          'Draft symbol pin mapping was checked against extracted provider evidence.',
          '2026-04-15T00:10:00.000Z',
          'api-test-validator',
          '2026-04-15T00:10:00.000Z'
        )
      `
    );
    await client.query(
      `
        INSERT INTO asset_promotion_audits VALUES (
          'promotion-draft-jlcparts-c1091-symbol-denied',
          'part-jlcparts-c1091',
          'asset-draft-jlcparts-c1091-symbol',
          'not_exportable',
          'not_exportable',
          'denied',
          '{"Promotion requires an explicit approved review state."}',
          NULL,
          'api-test-promoter',
          '2026-04-15T00:11:00.000Z'
        )
      `
    );
  } finally {
    client.release();
  }
}
