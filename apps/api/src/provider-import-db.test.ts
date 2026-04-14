/**
 * File header: Tests DB-backed API reads for a real-provider canonical import shape.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { buildPartDetailResponse } from "./detail-response";
import { readCatalogRecordsFromDatabase, readPartDetailRecordsFromDatabase, setCatalogStorePoolForTests } from "./catalog-store";
import type { Pool } from "pg";

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

    const searchResult = await readCatalogRecordsFromDatabase();
    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");

    assert.equal(searchResult.status, "available");
    assert.equal(detailResult.status, "available");

    if (searchResult.status !== "available" || detailResult.status !== "available") {
      throw new Error("expected DB-backed records");
    }

    const searchRecord = searchResult.records.find((record) => record.part.id === "part-jlcparts-c1091");
    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(searchRecord, "expected imported record in DB-backed search");
    assert.ok(detailRecord, "expected imported record in DB-backed detail");
    assert.equal(searchRecord.manufacturer.name, "FH(Guangdong Fenghua Advanced Tech)");
    assert.equal(searchRecord.sources[0]?.providerId, "jlcparts");
    assert.equal(searchRecord.metrics.find((metric) => metric.metricKey === "resistance")?.metricValue, 30);

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records);
    const datasheetGroup = detailResponse.assetGroups.find((group) => group.assetType === "datasheet");

    assert.equal(datasheetGroup?.bestAsset?.availabilityStatus, "referenced");
    assert.equal(datasheetGroup?.bestAsset?.exportStatus, "not_exportable");
    assert.equal(detailResponse.bundleReadiness.state, "references_only");
    assert.match(detailResponse.bundleReadiness.reason, /no file-backed CAD assets/u);
    assert.equal(detailResponse.generationOptions.find((option) => option.targetAssetType === "symbol")?.canRequest, false);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
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
 * Builds the minimum canonical schema needed by catalog-store's DB-backed read queries.
 */
function buildMinimalCatalogSchemaSql(): string {
  return `
    CREATE TABLE manufacturers (id TEXT, name TEXT, aliases TEXT[], website TEXT);
    CREATE TABLE packages (id TEXT, package_name TEXT, pin_count INTEGER, pitch_mm NUMERIC, body_length_mm NUMERIC, body_width_mm NUMERIC, body_height_mm NUMERIC);
    CREATE TABLE connector_families (id TEXT, name TEXT, series TEXT, description TEXT);
    CREATE TABLE parts (id TEXT, mpn TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_records (id TEXT, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
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
  `;
}

/**
 * Builds canonical rows for the real C1091/RC-02W300JT jlcparts import shape.
 */
function buildProviderImportRowsSql(): string {
  return `
    INSERT INTO manufacturers VALUES ('mfr-jlcparts-fh-guangdong-fenghua-advanced-tech', 'FH(Guangdong Fenghua Advanced Tech)', '{}', NULL);
    INSERT INTO packages VALUES ('pkg-jlcparts-0402', '0402', 2, NULL, NULL, NULL, NULL);
    INSERT INTO parts VALUES ('part-jlcparts-c1091', 'RC-02W300JT', 'mfr-jlcparts-fh-guangdong-fenghua-advanced-tech', 'Chip Resistor - Surface Mount', 'active', 'pkg-jlcparts-0402', NULL, 0.62, '2026-04-12T06:57:40.000Z');
    INSERT INTO source_records VALUES ('source-jlcparts-c1091', 'jlcparts', 'C1091', 'part-jlcparts-c1091', 'https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html', '2026-04-12T06:57:40.000Z', '{"component":{"lcsc":"C1091","mfr":"RC-02W300JT"},"indexCreatedAt":"2026-04-12T06:57:40+00:00"}'::jsonb, '2026-04-12T06:57:40.000Z', '2026-04-12T06:57:40.000Z');
    INSERT INTO assets VALUES ('asset-jlcparts-c1091-datasheet', 'part-jlcparts-c1091', 'datasheet', 'pdf', NULL, NULL, 'jlcparts', 'metadata_only', 'trusted_external', 'referenced', 'not_reviewed', 'not_exportable', 'referenced', NULL, NULL, 'not_validated', 'not_available', 'referenced', 'https://www.lcsc.com/datasheet/lcsc_datasheet_2411121005_FH--Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.pdf', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO datasheet_revisions VALUES ('dsr-jlcparts-c1091', 'part-jlcparts-c1091', 'Provider datasheet reference', NULL, NULL, 'asset-jlcparts-c1091-datasheet', 0, 'not_available', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO part_metrics VALUES ('metric-jlcparts-c1091-resistance-1', 'part-jlcparts-c1091', 'resistance', 30, 'ohm', NULL, NULL, 0.72, 'dsr-jlcparts-c1091', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
  `;
}
