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
      // Cross-part edges (mate/accessory/cable/similar/companion) only persist when both
      // endpoint part rows exist. The batched endpoint resolver is one
      // `SELECT id FROM parts WHERE id = ANY($1::text[])`; echo every requested id back as
      // existing so this test exercises the relationship inserts, not the FK-safe skip path.
      if (/SELECT id FROM parts WHERE id IN \(/u.test(text)) {
        const requestedIds = (values as string[] | undefined) ?? [];
        return { rows: requestedIds.map((id) => ({ id })) };
      }
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
  assert.match(sql, /INSERT INTO supply_offerings/u);
  assert.match(sql, /INSERT INTO price_breaks/u);
  assert.match(sql, /INSERT INTO generation_workflows/u);
  assert.match(sql, /INSERT INTO review_records/u);
  assert.match(sql, /INSERT INTO asset_validation_records/u);
  assert.match(sql, /INSERT INTO asset_promotion_audits/u);
  assert.match(sql, /INSERT INTO part_readiness_summaries/u);
  assert.match(sql, /INSERT INTO part_approvals/u);
  assert.match(sql, /INSERT INTO part_issues/u);
  assert.match(sql, /INSERT INTO part_risk_flags/u);
  assert.ok(tableCallIndex(calls, "connector_families") < tableCallIndex(calls, "parts"));
  assert.ok(tableCallIndex(calls, "source_records") < tableCallIndex(calls, "supply_offerings"));
  assert.ok(tableCallIndex(calls, "supply_offerings") < tableCallIndex(calls, "price_breaks"));
  assert.ok(tableCallIndex(calls, "generation_workflows") < tableCallIndex(calls, "review_records"));
  assert.ok(tableCallIndex(calls, "review_records") < tableCallIndex(calls, "asset_validation_records"));
});

/**
 * Verifies preview_status is only persisted as ready for embeddable local artifacts.
 */
test("persistNormalizedPartRows downgrades ready preview for non-embeddable assets", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [] };
    }
  } as unknown as PoolClient;
  const normalizedPart = buildNormalizedConnectorPart();

  await persistNormalizedPartRows(client, normalizedPart);

  const assetCall = calls.find((call) => call.text.includes("INSERT INTO assets"));
  assert.ok(assetCall);
  // preview_status positional value in the INSERT value list.
  assert.equal(assetCall.values?.[16], "not_available");
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
 * Verifies supply offering snapshots and price tiers are persisted with source provenance.
 */
test("persistNormalizedPartRows persists supply offerings and replaces stale price tiers", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    const firstImport = buildSupplyImportPart("2026-04-12T00:00:00.000Z", 1200, [
      { minQuantity: 1, unitPrice: 0.12 },
      { minQuantity: 100, unitPrice: 0.08 }
    ]);
    const originalOffering = firstImport.supplyOfferings[0];

    assert.ok(originalOffering);
    firstImport.supplyOfferings.push({
      ...originalOffering,
      id: "supply-repeat-c1-retired",
      inventoryQuantity: 10,
      priceBreaks: [],
      providerSku: "C1-OLD"
    });
    const refreshedImport = buildSupplyImportPart("2026-04-12T03:00:00.000Z", 800, [
      { minQuantity: 1, unitPrice: 0.11 }
    ]);

    await persistNormalizedPartRows(client, firstImport);
    await persistNormalizedPartRows(client, refreshedImport);

    const offeringRows = await client.query<{ inventory_quantity: number; last_seen_at: Date | string; source_record_id: string }>(
      "SELECT inventory_quantity, last_seen_at, source_record_id FROM supply_offerings WHERE id = 'supply-repeat-c1'"
    );
    const retiredRows = await client.query<{ id: string; retired_at: Date | string | null; retirement_reason: string | null }>(
      "SELECT id, retired_at, retirement_reason FROM supply_offerings ORDER BY id ASC"
    );
    const priceRows = await client.query<{ min_quantity: number; unit_price: string }>(
      "SELECT min_quantity, unit_price FROM price_breaks WHERE supply_offering_id = 'supply-repeat-c1' ORDER BY min_quantity ASC"
    );

    assert.equal(offeringRows.rows.length, 1);
    assert.equal(offeringRows.rows[0]?.inventory_quantity, 800);
    assert.equal(offeringRows.rows[0]?.source_record_id, "source-repeat-provider-c1");
    assert.equal(new Date(offeringRows.rows[0]?.last_seen_at ?? 0).toISOString(), "2026-04-12T03:00:00.000Z");
    assert.equal(retiredRows.rows.find((row) => row.id === "supply-repeat-c1")?.retired_at, null);
    assert.ok(retiredRows.rows.find((row) => row.id === "supply-repeat-c1-retired")?.retired_at, "missing offer should be retired");
    assert.equal(retiredRows.rows.find((row) => row.id === "supply-repeat-c1-retired")?.retirement_reason, "missing_from_latest_provider_snapshot");
    assert.deepEqual(priceRows.rows.map((row) => [row.min_quantity, Number(row.unit_price)]), [[1, 0.11]]);
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies provider metadata refreshes cannot erase already downloaded and reviewed file evidence.
 */
test("persistNormalizedPartRows preserves stored asset evidence during reference-only refreshes", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(
      client,
      buildDatasheetAssetImportPart({
        fileHash: "sha256:stored-datasheet",
        lastUpdatedAt: "2026-04-12T00:00:00.000Z",
        sourceUrl: "https://provider.example/old-datasheet.pdf",
        storageKey: "datasheets/repeat-c1.pdf"
      })
    );

    await persistNormalizedPartRows(
      client,
      buildDatasheetAssetImportPart({
        fileHash: null,
        lastUpdatedAt: "2026-04-12T03:00:00.000Z",
        sourceUrl: "https://provider.example/new-datasheet.pdf",
        storageKey: null
      })
    );

    const assetRows = await client.query<{
      asset_state: string;
      asset_status: string;
      availability_status: string;
      export_status: string;
      file_hash: string | null;
      preview_artifact_format: string | null;
      preview_artifact_source: string | null;
      preview_artifact_storage_key: string | null;
      preview_status: string;
      review_status: string;
      source_url: string | null;
      storage_key: string | null;
      validation_status: string;
    }>(
      `
        SELECT
          asset_state,
          asset_status,
          availability_status,
          export_status,
          file_hash,
          preview_artifact_format,
          preview_artifact_source,
          preview_artifact_storage_key,
          preview_status,
          review_status,
          source_url,
          storage_key,
          validation_status
        FROM assets
        WHERE id = 'asset-repeat-c1-datasheet'
      `
    );

    assert.equal(assetRows.rows.length, 1);
    assert.equal(assetRows.rows[0]?.storage_key, "datasheets/repeat-c1.pdf");
    assert.equal(assetRows.rows[0]?.file_hash, "sha256:stored-datasheet");
    assert.equal(assetRows.rows[0]?.availability_status, "validated");
    assert.equal(assetRows.rows[0]?.asset_state, "validated");
    assert.equal(assetRows.rows[0]?.asset_status, "verified_for_export");
    assert.equal(assetRows.rows[0]?.review_status, "approved");
    assert.equal(assetRows.rows[0]?.export_status, "verified_for_export");
    assert.equal(assetRows.rows[0]?.validation_status, "verified");
    assert.equal(assetRows.rows[0]?.preview_status, "ready");
    assert.equal(assetRows.rows[0]?.preview_artifact_storage_key, "datasheets/repeat-c1.pdf");
    assert.equal(assetRows.rows[0]?.preview_artifact_format, "pdf");
    assert.equal(assetRows.rows[0]?.preview_artifact_source, "source_native");
    assert.equal(assetRows.rows[0]?.source_url, "https://provider.example/new-datasheet.pdf");
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies non-active lifecycle parts persist lifecycle issue and risk projections for DB-backed reads.
 */
test("persistNormalizedPartRows stores lifecycle risk projection rows for non-active parts", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildMinimalImportPart("2026-04-12T00:00:00.000Z", 0.6, "not_recommended"));

    const issueRows = await client.query<{ detail: string; issue_code: string; severity: string }>(
      "SELECT issue_code, severity, detail FROM part_issues WHERE part_id = 'part-repeat-c1' ORDER BY issue_code ASC"
    );
    const riskRows = await client.query<{ detail: string; risk_code: string; tone: string }>(
      "SELECT risk_code, tone, detail FROM part_risk_flags WHERE part_id = 'part-repeat-c1' ORDER BY risk_code ASC"
    );

    assert.equal(issueRows.rows.some((row) => row.issue_code === "lifecycle_risk"), true);
    assert.equal(issueRows.rows.find((row) => row.issue_code === "lifecycle_risk")?.severity, "warning");
    assert.match(issueRows.rows.find((row) => row.issue_code === "lifecycle_risk")?.detail ?? "", /not active/u);
    assert.equal(riskRows.rows.some((row) => row.risk_code === "lifecycle_not_active"), true);
    assert.equal(riskRows.rows.find((row) => row.risk_code === "lifecycle_not_active")?.tone, "review");
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies failed imports refresh source-conflict projections when the source row already belongs to a canonical part.
 */
test("persistProviderImportFailureRows refreshes source conflict projection rows for attached parts", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildMinimalImportPart("2026-04-12T00:00:00.000Z", 0.7));
    await persistProviderImportFailureRows(client, {
      error: new Error("provider timeout"),
      failedAt: "2026-04-12T04:00:00.000Z",
      providerId: "repeat-provider",
      providerPartKey: "C1"
    });

    const sourceRow = await client.query<{ import_status: string; part_id: string | null }>(
      "SELECT part_id, import_status FROM source_records WHERE id = 'source-repeat-provider-c1'"
    );
    const issueRows = await client.query<{ detail: string; issue_code: string }>(
      "SELECT issue_code, detail FROM part_issues WHERE part_id = 'part-repeat-c1' ORDER BY issue_code ASC"
    );
    const riskRows = await client.query<{ detail: string; risk_code: string }>(
      "SELECT risk_code, detail FROM part_risk_flags WHERE part_id = 'part-repeat-c1' ORDER BY risk_code ASC"
    );

    assert.equal(sourceRow.rows[0]?.part_id, "part-repeat-c1");
    assert.equal(sourceRow.rows[0]?.import_status, "failed");
    assert.equal(issueRows.rows.some((row) => row.issue_code === "source_conflict"), true);
    assert.match(issueRows.rows.find((row) => row.issue_code === "source_conflict")?.detail ?? "", /provenance should be reviewed/u);
    assert.equal(riskRows.rows.some((row) => row.risk_code === "source_conflict"), true);
    assert.match(riskRows.rows.find((row) => row.risk_code === "source_conflict")?.detail ?? "", /provider import failed/u);
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies alternate mates in a different persisted connector family produce DB-backed family-conflict rows.
 */
test("persistNormalizedPartRows derives connector family conflict rows from stored alternate mates", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildConnectorConflictSupportPart("part-best-mate", "BEST-100", "cf-header", "Header Family", "best-provider", "BEST"));
    await persistNormalizedPartRows(client, buildConnectorConflictSupportPart("part-alt-mate", "ALT-200", "cf-wire-to-board", "Wire-to-Board Family", "alt-provider", "ALT"));
    await persistNormalizedPartRows(client, buildConnectorConflictSourcePart());

    const conflictRows = await client.query<{ candidate_part_id: string; conflict_type: string; detail: string; summary: string }>(
      "SELECT candidate_part_id, conflict_type, summary, detail FROM connector_family_conflicts WHERE part_id = 'part-source-connector' ORDER BY candidate_part_id ASC"
    );

    assert.equal(conflictRows.rows.length, 1);
    assert.equal(conflictRows.rows[0]?.candidate_part_id, "part-alt-mate");
    assert.equal(conflictRows.rows[0]?.conflict_type, "family_confusion");
    assert.match(conflictRows.rows[0]?.summary ?? "", /connector-family/u);
    assert.match(conflictRows.rows[0]?.detail ?? "", /differs from the current or dominant mate family/u);
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies source-backed best-mate evidence can create a persisted family-conflict row on its own.
 */
test("persistNormalizedPartRows derives connector family conflict rows from best mate evidence", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildConnectorConflictSupportPart("part-best-mismatch", "BEST-MISMATCH", "cf-wire-to-board", "Wire-to-Board Family", "best-mismatch-provider", "BEST-MISMATCH"));
    await persistNormalizedPartRows(client, buildBestMateConflictSourcePart());

    const conflictRows = await client.query<{ candidate_part_id: string; conflict_type: string; summary: string }>(
      "SELECT candidate_part_id, conflict_type, summary FROM connector_family_conflicts WHERE part_id = 'part-best-conflict-source' ORDER BY candidate_part_id ASC"
    );

    assert.equal(conflictRows.rows.length, 1);
    assert.equal(conflictRows.rows[0]?.candidate_part_id, "part-best-mismatch");
    assert.equal(conflictRows.rows[0]?.conflict_type, "family_confusion");
    assert.match(conflictRows.rows[0]?.summary ?? "", /Best mate evidence crosses connector-family boundaries/u);
  } finally {
    client.release();
    await pool.end();
  }
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

test("persistNormalizedPartRows stamps the part's org on its children and re-ingest preserves ownership", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    // Ingest under org-acme: the part and its just-written children inherit org-acme.
    await persistNormalizedPartRows(client, buildMinimalImportPart("2026-04-12T00:00:00.000Z", 0.6), "org-acme");

    const part = await client.query<{ org_id: string }>("SELECT org_id FROM parts WHERE id = 'part-repeat-c1'");
    const source = await client.query<{ org_id: string | null }>("SELECT org_id FROM source_records WHERE id = 'source-repeat-provider-c1'");
    const readiness = await client.query<{ org_id: string | null }>("SELECT org_id FROM part_readiness_summaries WHERE part_id = 'part-repeat-c1'");

    assert.equal(part.rows[0]?.org_id, "org-acme");
    assert.equal(source.rows[0]?.org_id, "org-acme", "the part's source record inherits its org");
    assert.equal(readiness.rows[0]?.org_id, "org-acme", "the projection row inherits the part's org");

    // Re-ingest under a different org: persistPart keeps the part's original org, so children stay put.
    await persistNormalizedPartRows(client, buildMinimalImportPart("2026-04-12T03:00:00.000Z", 0.7), "org-other");

    const partAfter = await client.query<{ org_id: string }>("SELECT org_id FROM parts WHERE id = 'part-repeat-c1'");
    const sourceAfter = await client.query<{ org_id: string | null }>("SELECT org_id FROM source_records WHERE id = 'source-repeat-provider-c1'");

    assert.equal(partAfter.rows[0]?.org_id, "org-acme", "re-ingest does not re-own the part");
    assert.equal(sourceAfter.rows[0]?.org_id, "org-acme", "re-ingest does not re-own an existing child");
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
        compatibilityStatus: "verified",
        confidenceScore: 0.8,
        evidenceKind: "manual_review",
        id: "acc-test",
        notes: "Required accessory",
        partId: "part-test",
        relationshipType: "requires_accessory",
        sourceRecordId: "source-test",
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
        compatibilityStatus: "probable",
        confidenceScore: 0.7,
        id: "cable-test",
        notes: "Cable option",
        partId: "part-test",
        relationshipType: "supports_cable",
        shieldingRequirement: "unknown",
        sourceRecordId: "source-test",
        sourceRevisionId: "dsr-test",
        terminationStyle: "unknown",
        wireGaugeMax: null,
        wireGaugeMin: null
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
    connectorFamilyConflicts: [],
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
        compatibilityStatus: "verified",
        confidenceScore: 0.9,
        evidenceKind: "manual_review",
        id: "mate-test",
        matePartId: "part-mate",
        notes: "Best mate",
        partId: "part-test",
        relationshipType: "best_mate",
        sourceRecordId: "source-test",
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
      description: "",
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
    supplyOfferings: [
      {
        createdAt: "2026-04-12T00:00:00.000Z",
        currencyCode: "USD",
        id: "supply-test",
        inventoryQuantity: 1200,
        inventoryStatus: "in_stock",
        lastSeenAt: "2026-04-12T00:00:00.000Z",
        leadTimeDays: null,
        moq: 1,
        packaging: "reel",
        partId: "part-test",
        preferredRank: 1,
        priceBreaks: [
          {
            capturedAt: "2026-04-12T00:00:00.000Z",
            currencyCode: "USD",
            id: "price-test-1",
            minQuantity: 1,
            supplyOfferingId: "supply-test",
            unitPrice: 0.12
          }
        ],
        providerId: "test-provider",
        providerPartKey: "TEST",
        providerSku: "TEST-SKU",
        supplierName: "Test Supplier",
        sourceRecordId: "source-test",
        updatedAt: "2026-04-12T00:00:00.000Z"
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
function buildMinimalImportPart(
  lastUpdatedAt: string,
  trustScore: number,
  lifecycleStatus: NormalizedProviderPart["part"]["lifecycleStatus"] = "active"
): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    connectorFamilyConflicts: [],
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
      description: "",
      id: "part-repeat-c1",
      lastUpdatedAt,
      lifecycleStatus,
      manufacturerId: "mfr-repeat",
      mpn: "REPEAT-1",
      packageId: "pkg-repeat-0402",
      trustScore
    },
    reviewRecords: [],
    validationRecords: [],
    similarPartRelations: [],
    supplyOfferings: [],
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
 * Builds a minimal import with one supply offering for persistence refresh tests.
 */
function buildSupplyImportPart(
  lastUpdatedAt: string,
  inventoryQuantity: number,
  priceBreaks: Array<{ minQuantity: number; unitPrice: number }>
): NormalizedProviderPart {
  return {
    ...buildMinimalImportPart(lastUpdatedAt, 0.7),
    supplyOfferings: [
      {
        createdAt: lastUpdatedAt,
        currencyCode: "USD",
        id: "supply-repeat-c1",
        inventoryQuantity,
        inventoryStatus: inventoryQuantity > 0 ? "in_stock" : "out_of_stock",
        lastSeenAt: lastUpdatedAt,
        leadTimeDays: null,
        moq: 1,
        packaging: "cut tape",
        partId: "part-repeat-c1",
        preferredRank: 1,
        priceBreaks: priceBreaks.map((priceBreak, index) => ({
          capturedAt: lastUpdatedAt,
          currencyCode: "USD",
          id: `price-repeat-c1-${priceBreak.minQuantity}-${index + 1}`,
          minQuantity: priceBreak.minQuantity,
          supplyOfferingId: "supply-repeat-c1",
          unitPrice: priceBreak.unitPrice
        })),
        providerId: "repeat-provider",
        providerPartKey: "C1",
        providerSku: "C1",
        supplierName: "Repeat Supplier",
        sourceRecordId: "source-repeat-provider-c1",
        updatedAt: lastUpdatedAt
      }
    ]
  };
}

/**
 * Builds a repeated datasheet import whose asset can be either file-backed or reference-only.
 */
function buildDatasheetAssetImportPart(input: {
  fileHash: string | null;
  lastUpdatedAt: string;
  sourceUrl: string;
  storageKey: string | null;
}): NormalizedProviderPart {
  const hasStoredFile = input.storageKey !== null && input.fileHash !== null;
  const assetState = hasStoredFile ? "validated" : "referenced";
  const assetStatus = hasStoredFile ? "verified_for_export" : "referenced";
  const validationStatus = hasStoredFile ? "verified" : "not_validated";

  return {
    ...buildMinimalImportPart(input.lastUpdatedAt, 0.7),
    assets: [
      withCanonicalAssetTruth({
        assetState,
        assetStatus,
        assetType: "datasheet",
        fileFormat: "pdf",
        fileHash: input.fileHash,
        generationMethod: null,
        generationSourceAssetId: null,
        id: "asset-repeat-c1-datasheet",
        lastUpdatedAt: input.lastUpdatedAt,
        licenseMode: "metadata_only",
        partId: "part-repeat-c1",
        previewStatus: hasStoredFile ? "ready" : "not_available",
        providerId: "repeat-provider",
        provenance: "trusted_external",
        sourceRecordId: "source-repeat-provider-c1",
        sourceUrl: input.sourceUrl,
        storageKey: input.storageKey,
        validationStatus
      })
    ],
    datasheetRevisions: [
      {
        fileAssetId: "asset-repeat-c1-datasheet",
        id: "dsr-repeat-c1",
        lastUpdatedAt: input.lastUpdatedAt,
        pageCount: null,
        parseConfidence: 0,
        partId: "part-repeat-c1",
        pinTableStatus: "not_available",
        revisionDate: null,
        revisionLabel: "Provider datasheet reference",
        sourceRecordId: "source-repeat-provider-c1"
      }
    ]
  };
}

/**
 * Builds a minimal connector part that provides stored connector-family identity for conflict derivation tests.
 */
function buildConnectorConflictSupportPart(
  partId: string,
  mpn: string,
  connectorFamilyId: string,
  connectorFamilyName: string,
  providerId: string,
  providerPartKey: string
): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: {
      description: `${connectorFamilyName} description`,
      id: connectorFamilyId,
      name: connectorFamilyName,
      series: `${connectorFamilyName} series`
    },
    connectorFamilyConflicts: [],
    datasheetRevisions: [],
    extractionSignals: [],
    generationWorkflows: [],
    manufacturer: {
      aliases: [],
      id: "mfr-connector-conflict",
      name: "Connector Conflict Manufacturer",
      website: null
    },
    mateRelations: [],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-connector-conflict",
      packageName: "TEST-CONNECTOR",
      pinCount: 2,
      pitchMm: 2.54
    },
    part: {
      category: "Connector",
      connectorFamilyId,
      description: "",
      id: partId,
      lastUpdatedAt: "2026-04-16T00:00:00.000Z",
      lifecycleStatus: "active",
      manufacturerId: "mfr-connector-conflict",
      mpn,
      packageId: "pkg-connector-conflict",
      trustScore: 0.8
    },
    promotionAudits: [],
    reviewRecords: [],
    similarPartRelations: [],
    supplyOfferings: [],
    sourceRecord: {
      fetchedAt: "2026-04-16T00:00:00.000Z",
      id: `source-${providerId}-${providerPartKey.toLowerCase()}`,
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt: "2026-04-16T00:00:00.000Z",
      normalizedAt: "2026-04-16T00:00:00.000Z",
      partId,
      providerId,
      providerPartKey,
      rawPayload: { providerPartKey },
      sourceLastImportedAt: "2026-04-16T00:00:00.000Z",
      sourceLastSeenAt: "2026-04-16T00:00:00.000Z",
      sourceUrl: `https://example.test/${providerPartKey.toLowerCase()}`
    },
    validationRecords: []
  };
}

/**
 * Builds one connector source part with a best mate and a cross-family alternate mate.
 */
function buildConnectorConflictSourcePart(): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: {
      description: "Board header family description",
      id: "cf-header",
      name: "Header Family",
      series: "Header Series"
    },
    connectorFamilyConflicts: [],
    datasheetRevisions: [
      {
        fileAssetId: null,
        id: "dsr-source-connector",
        lastUpdatedAt: "2026-04-16T00:05:00.000Z",
        pageCount: null,
        parseConfidence: 0.9,
        pinTableStatus: "not_available",
        partId: "part-source-connector",
        revisionDate: "2026-04-16",
        revisionLabel: "Connector Rev A",
        sourceRecordId: "source-source-provider-src"
      }
    ],
    extractionSignals: [],
    generationWorkflows: [],
    manufacturer: {
      aliases: [],
      id: "mfr-connector-conflict",
      name: "Connector Conflict Manufacturer",
      website: null
    },
    mateRelations: [
      {
        compatibilityStatus: "verified",
        confidenceScore: 0.94,
        evidenceKind: "provider_direct",
        id: "mate-source-best",
        matePartId: "part-best-mate",
        notes: "Primary keyed mate.",
        partId: "part-source-connector",
        relationshipType: "best_mate",
        sourceRecordId: "source-source-provider-src",
        sourceRevisionId: "dsr-source-connector"
      },
      {
        compatibilityStatus: "probable",
        confidenceScore: 0.88,
        evidenceKind: "provider_direct",
        id: "mate-source-alt",
        matePartId: "part-alt-mate",
        notes: "Close mechanical candidate with different family shell.",
        partId: "part-source-connector",
        relationshipType: "alternate_mate",
        sourceRecordId: "source-source-provider-src",
        sourceRevisionId: "dsr-source-connector"
      }
    ],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-connector-conflict",
      packageName: "TEST-CONNECTOR",
      pinCount: 2,
      pitchMm: 2.54
    },
    part: {
      category: "Connector",
      connectorFamilyId: "cf-header",
      description: "",
      id: "part-source-connector",
      lastUpdatedAt: "2026-04-16T00:05:00.000Z",
      lifecycleStatus: "active",
      manufacturerId: "mfr-connector-conflict",
      mpn: "SRC-300",
      packageId: "pkg-connector-conflict",
      trustScore: 0.86
    },
    promotionAudits: [],
    reviewRecords: [],
    similarPartRelations: [],
    supplyOfferings: [],
    sourceRecord: {
      fetchedAt: "2026-04-16T00:05:00.000Z",
      id: "source-source-provider-src",
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt: "2026-04-16T00:05:00.000Z",
      normalizedAt: "2026-04-16T00:05:00.000Z",
      partId: "part-source-connector",
      providerId: "source-provider",
      providerPartKey: "SRC",
      rawPayload: { providerPartKey: "SRC" },
      sourceLastImportedAt: "2026-04-16T00:05:00.000Z",
      sourceLastSeenAt: "2026-04-16T00:05:00.000Z",
      sourceUrl: "https://example.test/src"
    },
    validationRecords: []
  };
}

/**
 * Builds one connector source part whose best mate alone crosses connector-family boundaries.
 */
function buildBestMateConflictSourcePart(): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: {
      description: "Header family description",
      id: "cf-header",
      name: "Header Family",
      series: "Header Series"
    },
    connectorFamilyConflicts: [],
    datasheetRevisions: [
      {
        fileAssetId: null,
        id: "dsr-best-conflict-source",
        lastUpdatedAt: "2026-04-16T00:10:00.000Z",
        pageCount: null,
        parseConfidence: 0.9,
        pinTableStatus: "not_available",
        partId: "part-best-conflict-source",
        revisionDate: "2026-04-16",
        revisionLabel: "Connector Rev B",
        sourceRecordId: "source-best-conflict-src"
      }
    ],
    extractionSignals: [],
    generationWorkflows: [],
    manufacturer: {
      aliases: [],
      id: "mfr-connector-conflict",
      name: "Connector Conflict Manufacturer",
      website: null
    },
    mateRelations: [
      {
        compatibilityStatus: "verified",
        confidenceScore: 0.91,
        evidenceKind: "provider_direct",
        id: "mate-best-conflict",
        matePartId: "part-best-mismatch",
        notes: "Provider-backed mate candidate that points to a different connector family.",
        partId: "part-best-conflict-source",
        relationshipType: "best_mate",
        sourceRecordId: "source-best-conflict-src",
        sourceRevisionId: "dsr-best-conflict-source"
      }
    ],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-connector-conflict",
      packageName: "TEST-CONNECTOR",
      pinCount: 2,
      pitchMm: 2.54
    },
    part: {
      category: "Connector",
      connectorFamilyId: "cf-header",
      description: "",
      id: "part-best-conflict-source",
      lastUpdatedAt: "2026-04-16T00:10:00.000Z",
      lifecycleStatus: "active",
      manufacturerId: "mfr-connector-conflict",
      mpn: "SRC-BEST-CONFLICT",
      packageId: "pkg-connector-conflict",
      trustScore: 0.84
    },
    promotionAudits: [],
    reviewRecords: [],
    similarPartRelations: [],
    supplyOfferings: [],
    sourceRecord: {
      fetchedAt: "2026-04-16T00:10:00.000Z",
      id: "source-best-conflict-src",
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt: "2026-04-16T00:10:00.000Z",
      normalizedAt: "2026-04-16T00:10:00.000Z",
      partId: "part-best-conflict-source",
      providerId: "best-conflict-provider",
      providerPartKey: "SRC-BEST-CONFLICT",
      rawPayload: { providerPartKey: "SRC-BEST-CONFLICT" },
      sourceLastImportedAt: "2026-04-16T00:10:00.000Z",
      sourceLastSeenAt: "2026-04-16T00:10:00.000Z",
      sourceUrl: "https://example.test/src-best-conflict"
    },
    validationRecords: []
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
    CREATE TABLE connector_families (id TEXT PRIMARY KEY, name TEXT, series TEXT, description TEXT);
    CREATE TABLE parts (id TEXT PRIMARY KEY, mpn TEXT, description TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, org_id TEXT DEFAULT 'org-default', last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_records (id TEXT PRIMARY KEY, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE supply_offerings (id TEXT PRIMARY KEY, part_id TEXT, provider_id TEXT, source_record_id TEXT, provider_part_key TEXT, supplier_name TEXT, provider_sku TEXT, inventory_status TEXT, inventory_quantity INTEGER, moq INTEGER, lead_time_days INTEGER, packaging TEXT, currency_code TEXT, preferred_rank INTEGER, last_seen_at TIMESTAMPTZ, retired_at TIMESTAMPTZ, retirement_reason TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
    CREATE TABLE price_breaks (id TEXT PRIMARY KEY, supply_offering_id TEXT, min_quantity INTEGER, unit_price NUMERIC, currency_code TEXT, captured_at TIMESTAMPTZ);
    CREATE TABLE assets (id TEXT PRIMARY KEY, part_id TEXT, asset_type TEXT, file_format TEXT, storage_key TEXT, file_hash TEXT, provider_id TEXT, license_mode TEXT, provenance TEXT, availability_status TEXT, review_status TEXT, export_status TEXT, asset_status TEXT, generation_method TEXT, generation_source_asset_id TEXT, validation_status TEXT, preview_status TEXT, preview_artifact_storage_key TEXT, preview_artifact_format TEXT, preview_artifact_generated_at TIMESTAMPTZ, preview_artifact_source TEXT, asset_state TEXT, source_url TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE datasheet_revisions (id TEXT PRIMARY KEY, part_id TEXT, revision_label TEXT, revision_date DATE, page_count INTEGER, file_asset_id TEXT, parse_confidence NUMERIC, pin_table_status TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_metrics (id TEXT PRIMARY KEY, part_id TEXT, metric_key TEXT, metric_value NUMERIC, unit TEXT, min_value NUMERIC, max_value NUMERIC, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_extraction_signals (id TEXT PRIMARY KEY, part_id TEXT, source_record_id TEXT, datasheet_revision_id TEXT, asset_id TEXT, signal_type TEXT, extraction_status TEXT, confidence_score NUMERIC, extraction_source TEXT, notes TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE mate_relations (id TEXT PRIMARY KEY, part_id TEXT, mate_part_id TEXT, relationship_type TEXT, compatibility_status TEXT, evidence_kind TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE accessory_requirements (id TEXT PRIMARY KEY, part_id TEXT, accessory_part_id TEXT, relationship_type TEXT, compatibility_status TEXT, evidence_kind TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE cable_compatibilities (id TEXT PRIMARY KEY, part_id TEXT, cable_part_id TEXT, relationship_type TEXT, wire_gauge_min INTEGER, wire_gauge_max INTEGER, shielding_requirement TEXT, termination_style TEXT, compatibility_status TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE connector_family_conflicts (id TEXT PRIMARY KEY, part_id TEXT, candidate_part_id TEXT, candidate_connector_family_id TEXT, conflict_type TEXT, confidence_score NUMERIC, summary TEXT, detail TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ, UNIQUE (part_id, candidate_part_id, conflict_type));
    CREATE TABLE generation_workflows (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, generation_status TEXT, confidence_score NUMERIC, output_asset_id TEXT);
    CREATE TABLE generation_requests (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, request_status TEXT, requested_at TIMESTAMPTZ, requested_by TEXT, workflow_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE review_records (id TEXT PRIMARY KEY, part_id TEXT, target_type TEXT, asset_id TEXT, generation_workflow_id TEXT, outcome TEXT, reviewer TEXT, notes TEXT, reviewed_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_validation_records (id TEXT PRIMARY KEY, part_id TEXT, asset_id TEXT, validation_status TEXT, validation_type TEXT, validation_notes TEXT, validated_at TIMESTAMPTZ, validator TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_promotion_audits (id TEXT PRIMARY KEY, part_id TEXT, asset_id TEXT, prior_export_status TEXT, new_export_status TEXT, promotion_outcome TEXT, blocker_reasons TEXT[], validation_record_id TEXT, actor TEXT, created_at TIMESTAMPTZ);
    CREATE TABLE part_readiness_summaries (part_id TEXT PRIMARY KEY, readiness_status TEXT, identity_status TEXT, connector_class TEXT, blocker_count INTEGER, blocker_summary TEXT[], recommended_actions TEXT[], detail TEXT, last_evaluated_at TIMESTAMPTZ);
    CREATE TABLE part_approvals (part_id TEXT PRIMARY KEY, approval_status TEXT, summary TEXT, detail TEXT, evidence TEXT[], decided_by TEXT, decided_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_issues (id TEXT PRIMARY KEY, part_id TEXT, issue_code TEXT, severity TEXT, status TEXT, assigned_to TEXT, resolution_notes TEXT, resolved_at TIMESTAMPTZ, summary TEXT, detail TEXT, source TEXT, last_updated_at TIMESTAMPTZ, UNIQUE (part_id, issue_code));
    CREATE TABLE part_source_reconciliations (part_id TEXT PRIMARY KEY, preferred_source_record_id TEXT, resolution_status TEXT, notes TEXT, updated_by TEXT, updated_at TIMESTAMPTZ);
    CREATE TABLE part_risk_flags (id TEXT PRIMARY KEY, part_id TEXT, risk_code TEXT, label TEXT, detail TEXT, tone TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE similar_part_relations (id TEXT PRIMARY KEY, part_id TEXT, similar_part_id TEXT, confidence_score NUMERIC, reason TEXT);
    CREATE TABLE companion_recommendations (id TEXT PRIMARY KEY, part_id TEXT, companion_part_id TEXT, confidence_score NUMERIC, usage_context TEXT);

    -- Tenant isolation (2c): the part-attached children carry org_id (connector_family_conflicts stays
    -- global). No DEFAULT, so the worker's post-pass stamping from the part is observable in tests.
    ALTER TABLE source_records ADD COLUMN org_id TEXT;
    ALTER TABLE supply_offerings ADD COLUMN org_id TEXT;
    ALTER TABLE price_breaks ADD COLUMN org_id TEXT;
    ALTER TABLE assets ADD COLUMN org_id TEXT;
    ALTER TABLE datasheet_revisions ADD COLUMN org_id TEXT;
    ALTER TABLE part_metrics ADD COLUMN org_id TEXT;
    ALTER TABLE source_extraction_signals ADD COLUMN org_id TEXT;
    ALTER TABLE mate_relations ADD COLUMN org_id TEXT;
    ALTER TABLE accessory_requirements ADD COLUMN org_id TEXT;
    ALTER TABLE cable_compatibilities ADD COLUMN org_id TEXT;
    ALTER TABLE similar_part_relations ADD COLUMN org_id TEXT;
    ALTER TABLE companion_recommendations ADD COLUMN org_id TEXT;
    ALTER TABLE generation_workflows ADD COLUMN org_id TEXT;
    ALTER TABLE generation_requests ADD COLUMN org_id TEXT;
    ALTER TABLE review_records ADD COLUMN org_id TEXT;
    ALTER TABLE asset_validation_records ADD COLUMN org_id TEXT;
    ALTER TABLE asset_promotion_audits ADD COLUMN org_id TEXT;
    ALTER TABLE part_readiness_summaries ADD COLUMN org_id TEXT;
    ALTER TABLE part_approvals ADD COLUMN org_id TEXT;
    ALTER TABLE part_issues ADD COLUMN org_id TEXT;
    ALTER TABLE part_source_reconciliations ADD COLUMN org_id TEXT;
    ALTER TABLE part_risk_flags ADD COLUMN org_id TEXT;
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
    CREATE TABLE parts (id TEXT PRIMARY KEY, mpn TEXT, org_id TEXT DEFAULT 'org-default');
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
 * Verifies that importing two parts with the same MPN and package creates duplicate_candidate issues for both.
 */
test("persistNormalizedPartRows creates duplicate_candidate issues for parts sharing MPN and package", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildDuplicateTestPart("part-dup-a", "dup-provider-a", "DUP-KEY-A"));
    await persistNormalizedPartRows(client, buildDuplicateTestPart("part-dup-b", "dup-provider-b", "DUP-KEY-B"));

    const issuesA = await client.query<{ issue_code: string }>(
      "SELECT issue_code FROM part_issues WHERE part_id = 'part-dup-a' AND issue_code = 'duplicate_candidate'"
    );
    const issuesB = await client.query<{ issue_code: string }>(
      "SELECT issue_code FROM part_issues WHERE part_id = 'part-dup-b' AND issue_code = 'duplicate_candidate'"
    );

    assert.equal(issuesA.rows.length, 1, "part-dup-a should have a duplicate_candidate issue after part-dup-b import");
    assert.equal(issuesB.rows.length, 1, "part-dup-b should have a duplicate_candidate issue");
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies that parts with distinct MPNs do not produce duplicate_candidate issues.
 */
test("persistNormalizedPartRows does not create duplicate_candidate issues for distinct MPNs", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildDuplicateTestPart("part-unique-a", "unique-provider-a", "UNIQUE-A", "UNIQUE-MPN-A"));
    await persistNormalizedPartRows(client, buildDuplicateTestPart("part-unique-b", "unique-provider-b", "UNIQUE-B", "UNIQUE-MPN-B"));

    const issuesA = await client.query<{ issue_code: string }>(
      "SELECT issue_code FROM part_issues WHERE part_id = 'part-unique-a' AND issue_code = 'duplicate_candidate'"
    );
    const issuesB = await client.query<{ issue_code: string }>(
      "SELECT issue_code FROM part_issues WHERE part_id = 'part-unique-b' AND issue_code = 'duplicate_candidate'"
    );

    assert.equal(issuesA.rows.length, 0, "part-unique-a should have no duplicate_candidate issue");
    assert.equal(issuesB.rows.length, 0, "part-unique-b should have no duplicate_candidate issue");
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Verifies every successful import writes a part_readiness_summaries row with a fresh last_evaluated_at,
 * and that re-running the bulk recompute keeps the row populated and current. This guards against the
 * stale-summary failure mode P0-4 calls out: changes to derivePartProjection that never propagate to
 * existing parts because no recompute path runs.
 */
test("persistNormalizedPartRows writes a fresh part_readiness_summaries row on every import", async () => {
  const pool = createMinimalImportPool();
  const client = await pool.connect();

  try {
    const firstImportAt = "2026-04-12T00:00:00.000Z";
    const secondImportAt = "2026-04-12T05:00:00.000Z";

    await persistNormalizedPartRows(client, buildMinimalImportPart(firstImportAt, 0.6));

    const afterFirstImport = await client.query<{ last_evaluated_at: Date | string | null; readiness_status: string | null }>(
      "SELECT readiness_status, last_evaluated_at FROM part_readiness_summaries WHERE part_id = 'part-repeat-c1'"
    );

    assert.equal(afterFirstImport.rows.length, 1, "expected a readiness summary row after the first import");
    assert.ok(afterFirstImport.rows[0]?.last_evaluated_at, "expected non-null last_evaluated_at on first import");
    assert.ok(afterFirstImport.rows[0]?.readiness_status, "expected a readiness_status value on first import");

    await persistNormalizedPartRows(client, buildMinimalImportPart(secondImportAt, 0.85));

    const afterSecondImport = await client.query<{ last_evaluated_at: Date | string | null; readiness_status: string | null }>(
      "SELECT readiness_status, last_evaluated_at FROM part_readiness_summaries WHERE part_id = 'part-repeat-c1'"
    );

    assert.equal(afterSecondImport.rows.length, 1, "readiness summary should be upserted, not duplicated");

    const firstEvaluation = new Date(afterFirstImport.rows[0]?.last_evaluated_at ?? 0).getTime();
    const secondEvaluation = new Date(afterSecondImport.rows[0]?.last_evaluated_at ?? 0).getTime();

    assert.ok(secondEvaluation >= firstEvaluation, "subsequent imports must not move last_evaluated_at backwards");
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * Finds the first query call that writes to a table.
 */
function tableCallIndex(calls: QueryCall[], tableName: string): number {
  return calls.findIndex((call) => call.text.includes(`INSERT INTO ${tableName}`));
}

/**
 * Builds a minimal part payload for duplicate candidate detection tests.
 */
function buildDuplicateTestPart(
  partId: string,
  providerId: string,
  providerPartKey: string,
  mpn = "DUP-REG-100"
): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    connectorFamilyConflicts: [],
    datasheetRevisions: [],
    extractionSignals: [],
    generationWorkflows: [],
    manufacturer: {
      aliases: [],
      id: "mfr-dup-test",
      name: "Duplicate Test Manufacturer",
      website: null
    },
    mateRelations: [],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-dup-sot23",
      packageName: "SOT-23",
      pinCount: 3,
      pitchMm: null
    },
    part: {
      category: "Linear Regulators",
      connectorFamilyId: null,
      description: "LDO Regulator",
      id: partId,
      lastUpdatedAt: "2026-04-20T00:00:00.000Z",
      lifecycleStatus: "active",
      manufacturerId: "mfr-dup-test",
      mpn,
      packageId: "pkg-dup-sot23",
      trustScore: 0.85
    },
    promotionAudits: [],
    reviewRecords: [],
    similarPartRelations: [],
    supplyOfferings: [],
    sourceRecord: {
      fetchedAt: "2026-04-20T00:00:00.000Z",
      id: `source-${providerId}-${providerPartKey.toLowerCase()}`,
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt: "2026-04-20T00:00:00.000Z",
      normalizedAt: "2026-04-20T00:00:00.000Z",
      partId,
      providerId,
      providerPartKey,
      rawPayload: {},
      sourceLastImportedAt: "2026-04-20T00:00:00.000Z",
      sourceLastSeenAt: "2026-04-20T00:00:00.000Z",
      sourceUrl: null
    },
    validationRecords: []
  };
}
