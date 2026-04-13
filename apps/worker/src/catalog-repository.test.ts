/**
 * File header: Tests worker persistence coverage for connector intelligence rows.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { persistNormalizedPartRows } from "./catalog-repository";
import type { PoolClient } from "pg";
import type { NormalizedProviderPart } from "./provider-adapters";

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
  assert.match(sql, /INSERT INTO generation_workflows/u);
  assert.ok(tableCallIndex(calls, "connector_families") < tableCallIndex(calls, "parts"));
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
      {
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
      }
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
        partId: "part-test",
        revisionDate: "2026-04-12",
        revisionLabel: "Rev Test",
        sourceRecordId: "source-test"
      }
    ],
    generationWorkflows: [
      {
        confidenceScore: 0.8,
        generationStatus: "ready",
        id: "gen-test",
        outputAssetId: "asset-test-step",
        partId: "part-test",
        sourceAssetId: null,
        sourceDatasheetRevisionId: "dsr-test",
        targetAssetType: "three_d_model"
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
      lastUpdatedAt: "2026-04-12T00:00:00.000Z",
      normalizedAt: "2026-04-12T00:00:00.000Z",
      partId: "part-test",
      providerId: "test-provider",
      providerPartKey: "TEST",
      rawPayload: {},
      sourceUrl: null
    }
  };
}

/**
 * Finds the first query call that writes to a table.
 */
function tableCallIndex(calls: QueryCall[], tableName: string): number {
  return calls.findIndex((call) => call.text.includes(`INSERT INTO ${tableName}`));
}
