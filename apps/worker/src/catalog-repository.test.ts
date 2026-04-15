/**
 * File header: Tests worker persistence coverage for connector intelligence rows.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { withCanonicalAssetTruth } from "@ee-library/shared/asset-state";
import { listWorkerOperationalDiagnostics, persistNormalizedPartRows, persistProviderImportFailureRows, setWorkerRepositoryPoolForTests } from "./catalog-repository";
import type { Pool, PoolClient } from "pg";
import type { NormalizedProviderPart } from "./provider-adapters";

/** TestPool is the pg-mem pool shape used by repository integration tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it from catalog-store. */
  end: () => Promise<void>;
};

/** QueryCall captures SQL and values sent to the fake transaction client. */
interface QueryCall {
  /** SQL text sent to pg. */
  text: string;
  /** Values sent to pg. */
  values: unknown[] | undefined;
}

/**
 * Verifies worker persistence writes connector relation and generation workflow tables.
 */
test("persistNormalizedPartRows persists connector relationships and generation workflows", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [] };
    }
  } as unknown as PoolClient;

  await persistNormalizedPartRows(client, buildNormalizedConnectorPart());

  const sql = calls.map((call) => call.text).join("\n");

  assert.match(sql, /INSERT INTO connector_families/u);
  assert.match(sql, /INSERT INTO mate_relations/u);
  assert.match(sql, /INSERT INTO accessory_requirements/u);
  assert.match(sql, /INSERT INTO cable_compatibilities/u);
  assert.match(sql, /INSERT INTO similar_part_relations/u);
  assert.match(sql, /INSERT INTO companion_recommendations/u);
  assert.match(sql, /INSERT INTO source_extraction_signals/u);
  assert.match(sql, /INSERT INTO generation_workflows/u);
  assert.match(sql, /INSERT INTO review_records/u);
  assert.match(sql, /INSERT INTO asset_validation_records/u);
  assert.match(sql, /INSERT INTO asset_promotion_audits/u);
  assert.ok(tableCallIndex(calls, "connector_families") < tableCallIndex(calls, "parts"));
  assert.ok(tableCallIndex(calls, "generation_workflows") < tableCallIndex(calls, "review_records"));
  assert.ok(tableCallIndex(calls, "review_records") < tableCallIndex(calls, "asset_validation_records"));
});

/**
 * Verifies repeated source imports update the same deterministic rows with freshness fields.
 */
test("persistNormalizedPartRows upserts source import freshness metadata", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [] };
    }
  } as unknown as PoolClient;
  const normalizedPart = buildNormalizedConnectorPart();
  const updatedPart = {
    ...normalizedPart,
    sourceRecord: {
      ...normalizedPart.sourceRecord,
      fetchedAt: "2026-04-12T01:00:00.000Z",
      lastUpdatedAt: "2026-04-12T01:00:00.000Z",
      sourceLastImportedAt: "2026-04-12T01:00:00.000Z",
      sourceLastSeenAt: "2026-04-12T01:00:00.000Z"
    }
  };

  await persistNormalizedPartRows(client, normalizedPart);
  await persistNormalizedPartRows(client, updatedPart);

  const sourceCalls = calls.filter((call) => call.text.includes("INSERT INTO source_records"));

  assert.equal(sourceCalls.length, 2);
  assert.match(sourceCalls[0]?.text ?? "", /ON CONFLICT \(id\) DO UPDATE/u);
  assert.equal(sourceCalls[1]?.values?.[0], "source-test");
  assert.equal(sourceCalls[1]?.values?.[8], "2026-04-12T01:00:00.000Z");
  assert.equal(sourceCalls[1]?.values?.[9], "2026-04-12T01:00:00.000Z");
  assert.equal(sourceCalls[1]?.values?.[10], "imported");
  assert.equal(sourceCalls[1]?.values?.[11], null);
});

/**
 * Verifies failed provider imports are persisted as diagnostics without a fake part id.
 */
test("persistProviderImportFailureRows stores failed import diagnostics", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [] };
    }
  } as unknown as PoolClient;

  await persistProviderImportFailureRows(client, {
    error: new Error("provider returned 500"),
    failedAt: "2026-04-12T02:00:00.000Z",
    providerId: "test-provider",
    providerPartKey: "FAIL MPN"
  });

  const sourceCall = calls.find((call) => call.text.includes("INSERT INTO source_records"));

  assert.ok(sourceCall, "expected failed source record upsert");
  assert.equal(sourceCall.values?.[0], "source-test-provider-fail-mpn");
  assert.equal(sourceCall.values?.[3], null);
  assert.equal(sourceCall.values?.[8], "2026-04-12T02:00:00.000Z");
  assert.equal(sourceCall.values?.[9], null);
  assert.equal(sourceCall.values?.[10], "failed");
  assert.match(String(sourceCall.values?.[11]), /provider returned 500/u);
});

/**
 * Verifies repeat imports update canonical records instead of duplicating them.
 */
test("persistNormalizedPartRows repeat import updates stable canonical rows", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildMinimalImportPart("2026-04-12T00:00:00.000Z", 0.6));
    await persistNormalizedPartRows(client, buildMinimalImportPart("2026-04-12T03:00:00.000Z", 0.7));
    await persistProviderImportFailureRows(client, {
      error: new Error("repeat provider timeout"),
      failedAt: "2026-04-12T04:00:00.000Z",
      providerId: "repeat-provider",
      providerPartKey: "C1"
    });

    const partCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM parts");
    const sourceCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM source_records");
    const updatedPart = await client.query<{ trust_score: string; last_updated_at: Date }>("SELECT trust_score, last_updated_at FROM parts WHERE id = 'part-repeat-c1'");
    const updatedSource = await client.query<{ fetched_at: Date; import_error_details: string; import_status: string; part_id: string; source_last_seen_at: Date; source_last_imported_at: Date }>("SELECT fetched_at, import_error_details, import_status, part_id, source_last_seen_at, source_last_imported_at FROM source_records WHERE id = 'source-repeat-provider-c1'");

    assert.equal(partCount.rows[0]?.count, "1");
    assert.equal(sourceCount.rows[0]?.count, "1");
    assert.equal(Number(updatedPart.rows[0]?.trust_score), 0.7);
    assert.equal(updatedPart.rows[0]?.last_updated_at.toISOString(), "2026-04-12T03:00:00.000Z");
    assert.equal(updatedSource.rows[0]?.import_status, "failed");
    assert.equal(updatedSource.rows[0]?.part_id, "part-repeat-c1");
    assert.match(updatedSource.rows[0]?.import_error_details ?? "", /repeat provider timeout/u);
    assert.equal(updatedSource.rows[0]?.fetched_at.toISOString(), "2026-04-12T03:00:00.000Z");
    assert.equal(updatedSource.rows[0]?.source_last_seen_at.toISOString(), "2026-04-12T04:00:00.000Z");
    assert.equal(updatedSource.rows[0]?.source_last_imported_at.toISOString(), "2026-04-12T03:00:00.000Z");
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies worker operational diagnostics summarize imports, generation, review, validation, and promotion records.
 */
test("listWorkerOperationalDiagnostics returns local operational summaries", async () => {
  const pool = createOperationalDiagnosticsPool();

  try {
    setWorkerRepositoryPoolForTests(pool);

    const summary = await listWorkerOperationalDiagnostics(10);

    assert.equal(summary.recentImports.length, 2);
    assert.equal(summary.failedImports.length, 1);
    assert.equal(summary.failedImports[0]?.importErrorDetails, "provider timeout");
    assert.equal(summary.recentGenerationRuns[0]?.requestId, "genreq-test");
    assert.equal(summary.recentGenerationRuns[0]?.generationStatus, "review_required");
    assert.equal(summary.recentReviews[0]?.outcome, "approved");
    assert.equal(summary.recentValidations[0]?.validationStatus, "verified");
    assert.equal(summary.recentPromotions[0]?.promotionOutcome, "denied");
    assert.match(summary.recentPromotions[0]?.blockerReasons.join(" ") ?? "", /validation evidence/u);
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds a minimal connector part payload for repository persistence tests.
 */
function buildNormalizedConnectorPart(): NormalizedProviderPart {
  return {
    accessoryRequirements: [
      {
        accessoryPartId: "part-accessory",
        confidenceScore: 0.8,
        id: "acc-test",
        notes: "Required accessory",
        partId: "part-test",
        relationshipType: "requires_accessory",
        sourceRevisionId: "dsr-test"
      }
    ],
    assets: [
      withCanonicalAssetTruth({
        assetState: "validated",
        assetStatus: "validated",
        assetType: "three_d_model",
        fileFormat: "step",
        fileHash: "sha256:test",
        generationMethod: null,
        generationSourceAssetId: null,
        id: "asset-test-step",
        lastUpdatedAt: "2026-04-12T00:00:00.000Z",
        licenseMode: "redistribution_allowed",
        partId: "part-test",
        previewStatus: "ready",
        providerId: "test-provider",
        provenance: "trusted_external",
        sourceRecordId: "source-test",
        sourceUrl: null,
        storageKey: "cad/test.step",
        validationStatus: "verified"
      })
    ],
    cableCompatibilities: [
      {
        cablePartId: "part-cable",
        confidenceScore: 0.7,
        id: "cable-test",
        notes: "Cable option",
        partId: "part-test",
        relationshipType: "supports_cable",
        sourceRevisionId: "dsr-test"
      }
    ],
    companionRecommendations: [
      {
        companionPartId: "part-companion",
        confidenceScore: 0.5,
        id: "comp-test",
        partId: "part-test",
        usageContext: "Typical companion"
      }
    ],
    connectorFamily: {
      description: "Test connector family",
      id: "cf-test",
      name: "Test Family",
      series: "Test Series"
    },
    datasheetRevisions: [
      {
        fileAssetId: "asset-test-step",
        id: "dsr-test",
        lastUpdatedAt: "2026-04-12T00:00:00.000Z",
        pageCount: 1,
        parseConfidence: 0.8,
        pinTableStatus: "available",
        partId: "part-test",
        revisionDate: "2026-04-12",
        revisionLabel: "Rev Test",
        sourceRecordId: "source-test"
      }
    ],
    generationWorkflows: [
      {
        confidenceScore: 0.8,
        generationStatus: "available_to_request",
        id: "gen-test",
        outputAssetId: "asset-test-step",
        partId: "part-test",
        sourceAssetId: null,
        sourceDatasheetRevisionId: "dsr-test",
        targetAssetType: "three_d_model"
      }
    ],
    extractionSignals: [
      {
        assetId: "asset-test-step",
        confidenceScore: 0.7,
        datasheetRevisionId: "dsr-test",
        extractionSource: "asset_reference",
        extractionStatus: "needs_review",
        id: "sig-test-mechanical-drawing",
        lastUpdatedAt: "2026-04-12T00:00:00.000Z",
        notes: "Mechanical drawing source needs review.",
        partId: "part-test",
        signalType: "mechanical_drawing",
        sourceRecordId: "source-test"
      }
    ],
    reviewRecords: [
      {
        assetId: "asset-test-step",
        generationWorkflowId: null,
        id: "review-test-step",
        lastUpdatedAt: "2026-04-12T00:00:00.000Z",
        notes: "Reviewed by test fixture",
        outcome: "approved",
        partId: "part-test",
        reviewedAt: "2026-04-12T00:00:00.000Z",
        reviewer: "test-reviewer",
        targetType: "asset"
      }
    ],
    validationRecords: [
      {
        assetId: "asset-test-step",
        id: "validation-test-step",
        lastUpdatedAt: "2026-04-12T00:00:00.000Z",
        partId: "part-test",
        validatedAt: "2026-04-12T00:00:00.000Z",
        validationNotes: "3D geometry checked by test fixture.",
        validationStatus: "verified",
        validationType: "three_d_geometry",
        validator: "test-validator"
      }
    ],
    promotionAudits: [
      {
        actor: "test-promoter",
        assetId: "asset-test-step",
        blockerReasons: [],
        createdAt: "2026-04-12T00:00:00.000Z",
        id: "promotion-test-step",
        newExportStatus: "verified_for_export",
        partId: "part-test",
        priorExportStatus: "partially_exportable",
        promotionOutcome: "promoted",
        validationRecordId: "validation-test-step"
      }
    ],
    manufacturer: {
      aliases: [],
      id: "mfr-test",
      name: "Test Manufacturer",
      website: null
    },
    mateRelations: [
      {
        confidenceScore: 0.9,
        id: "mate-test",
        matePartId: "part-mate",
        notes: "Best mate",
        partId: "part-test",
        relationshipType: "best_mate",
        sourceRevisionId: "dsr-test"
      }
    ],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-test",
      packageName: "Test Package",
      pinCount: null,
      pitchMm: null
    },
    part: {
      category: "Connector",
      connectorFamilyId: "cf-test",
      id: "part-test",
      lastUpdatedAt: "2026-04-12T00:00:00.000Z",
      lifecycleStatus: "active",
      manufacturerId: "mfr-test",
      mpn: "TEST",
      packageId: "pkg-test",
      trustScore: 0.8
    },
    similarPartRelations: [
      {
        confidenceScore: 0.6,
        id: "sim-test",
        partId: "part-test",
        reason: "Same shell",
        similarPartId: "part-similar"
      }
    ],
    sourceRecord: {
      fetchedAt: "2026-04-12T00:00:00.000Z",
      id: "source-test",
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt: "2026-04-12T00:00:00.000Z",
      normalizedAt: "2026-04-12T00:00:00.000Z",
      partId: "part-test",
      providerId: "test-provider",
      providerPartKey: "TEST",
      rawPayload: {},
      sourceLastImportedAt: "2026-04-12T00:00:00.000Z",
      sourceLastSeenAt: "2026-04-12T00:00:00.000Z",
      sourceUrl: null
    }
  };
}

/**
 * Builds a small provider import payload with no optional relationship rows.
 */
function buildMinimalImportPart(lastUpdatedAt: string, trustScore: number): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    datasheetRevisions: [],
    generationWorkflows: [],
    extractionSignals: [],
    promotionAudits: [],
    manufacturer: {
      aliases: ["Repeat Alias"],
      id: "mfr-repeat",
      name: "Repeat Manufacturer",
      website: null
    },
    mateRelations: [],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-repeat-0402",
      packageName: "0402",
      pinCount: 2,
      pitchMm: null
    },
    part: {
      category: "Resistors / Chip Resistor - Surface Mount",
      connectorFamilyId: null,
      id: "part-repeat-c1",
      lastUpdatedAt,
      lifecycleStatus: "active",
      manufacturerId: "mfr-repeat",
      mpn: "REPEAT-1",
      packageId: "pkg-repeat-0402",
      trustScore
    },
    reviewRecords: [],
    validationRecords: [],
    similarPartRelations: [],
    sourceRecord: {
      fetchedAt: lastUpdatedAt,
      id: "source-repeat-provider-c1",
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt,
      normalizedAt: lastUpdatedAt,
      partId: "part-repeat-c1",
      providerId: "repeat-provider",
      providerPartKey: "C1",
      rawPayload: { lcsc: "C1" },
      sourceLastImportedAt: lastUpdatedAt,
      sourceLastSeenAt: lastUpdatedAt,
      sourceUrl: "https://example.test/c1"
    }
  };
}

/**
 * Creates a minimal in-memory schema for provider import idempotency tests.
 */
function createMinimalImportPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE manufacturers (id TEXT PRIMARY KEY, name TEXT, aliases TEXT[], website TEXT);
    CREATE TABLE packages (id TEXT PRIMARY KEY, package_name TEXT, pin_count INTEGER, pitch_mm NUMERIC, body_length_mm NUMERIC, body_width_mm NUMERIC, body_height_mm NUMERIC);
    CREATE TABLE parts (id TEXT PRIMARY KEY, mpn TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_records (id TEXT PRIMARY KEY, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_extraction_signals (id TEXT PRIMARY KEY, part_id TEXT, source_record_id TEXT, datasheet_revision_id TEXT, asset_id TEXT, signal_type TEXT, extraction_status TEXT, confidence_score NUMERIC, extraction_source TEXT, notes TEXT, last_updated_at TIMESTAMPTZ);
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Creates a small database with operational records for worker diagnostics tests.
 */
function createOperationalDiagnosticsPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (id TEXT PRIMARY KEY, mpn TEXT);
    CREATE TABLE source_records (id TEXT PRIMARY KEY, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE generation_workflows (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, generation_status TEXT, confidence_score NUMERIC, output_asset_id TEXT);
    CREATE TABLE generation_requests (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, request_status TEXT, requested_at TIMESTAMPTZ, requested_by TEXT, workflow_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE review_records (id TEXT PRIMARY KEY, part_id TEXT, target_type TEXT, asset_id TEXT, generation_workflow_id TEXT, outcome TEXT, reviewer TEXT, notes TEXT, reviewed_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_validation_records (id TEXT PRIMARY KEY, part_id TEXT, asset_id TEXT, validation_status TEXT, validation_type TEXT, validation_notes TEXT, validated_at TIMESTAMPTZ, validator TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_promotion_audits (id TEXT PRIMARY KEY, part_id TEXT, asset_id TEXT, prior_export_status TEXT, new_export_status TEXT, promotion_outcome TEXT, blocker_reasons TEXT[], validation_record_id TEXT, actor TEXT, created_at TIMESTAMPTZ);

    INSERT INTO parts VALUES ('part-ops', 'OPS-1');
    INSERT INTO source_records VALUES ('source-imported', 'ops-provider', 'OPS-1', 'part-ops', NULL, '2026-04-15T00:00:00.000Z', '{}', '2026-04-15T00:00:01.000Z', '2026-04-15T00:00:01.000Z', '2026-04-15T00:00:01.000Z', 'imported', NULL, '2026-04-15T00:00:01.000Z');
    INSERT INTO source_records VALUES ('source-failed', 'ops-provider', 'OPS-2', NULL, NULL, '2026-04-15T00:05:00.000Z', '{}', NULL, '2026-04-15T00:05:00.000Z', NULL, 'failed', 'provider timeout', '2026-04-15T00:05:00.000Z');
    INSERT INTO generation_workflows VALUES ('gen-ops', 'part-ops', 'symbol', NULL, NULL, 'review_required', 0.8, 'asset-ops-symbol');
    INSERT INTO generation_requests VALUES ('genreq-test', 'part-ops', 'symbol', NULL, NULL, 'review_required', '2026-04-15T00:10:00.000Z', 'local-dev', 'gen-ops', '2026-04-15T00:11:00.000Z');
    INSERT INTO review_records VALUES ('review-ops', 'part-ops', 'asset', 'asset-ops-symbol', NULL, 'approved', 'ops-reviewer', NULL, '2026-04-15T00:12:00.000Z', '2026-04-15T00:12:00.000Z');
    INSERT INTO asset_validation_records VALUES ('validation-ops', 'part-ops', 'asset-ops-symbol', 'verified', 'symbol_pin_mapping', 'Checked against pin table.', '2026-04-15T00:13:00.000Z', 'ops-validator', '2026-04-15T00:13:00.000Z');
    INSERT INTO asset_promotion_audits VALUES ('promotion-ops-denied', 'part-ops', 'asset-ops-symbol', 'not_exportable', 'not_exportable', 'denied', '{"Missing qualifying validation evidence."}', NULL, 'ops-promoter', '2026-04-15T00:14:00.000Z');
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Finds the first query call that writes to a table.
 */
function tableCallIndex(calls: QueryCall[], tableName: string): number {
  return calls.findIndex((call) => call.text.includes(`INSERT INTO ${tableName}`));
}
