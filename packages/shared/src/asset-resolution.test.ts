/**
 * File header: Tests seed-free asset ranking, bundle readiness, and generation option helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getPartDetail } from "./search";
import { evaluateGenerationSourceReadiness, getBundleReadinessSummary, getGenerationOptions, resolveAssetClassSummaries, selectBestAvailableAsset } from "./asset-resolution";
import type { Asset, PartSearchRecord } from "./types";

/**
 * Verifies export-ready file evidence outranks an official metadata reference.
 */
test("best-available asset ranking prefers export-ready files over official references", () => {
  const officialReference = buildAsset({
    assetState: "referenced",
    assetStatus: "reviewed",
    id: "asset-official-reference",
    lastUpdatedAt: "2026-04-13T00:00:00.000Z",
    provenance: "official",
    validationStatus: "needs_review"
  });
  const verifiedFile = buildAsset({
    assetState: "validated",
    assetStatus: "verified_for_export",
    fileHash: "sha256:verified",
    id: "asset-verified-file",
    lastUpdatedAt: "2026-04-12T00:00:00.000Z",
    provenance: "manual_internal",
    storageKey: "cad/test/footprint.kicad_mod",
    validationStatus: "verified"
  });

  assert.equal(selectBestAvailableAsset([officialReference, verifiedFile])?.id, "asset-verified-file");
});

/**
 * Verifies recency is used only after readiness, validation, and provenance tie.
 */
test("best-available asset ranking uses recency as a deterministic tie-break", () => {
  const olderAsset = buildAsset({ id: "asset-older", lastUpdatedAt: "2026-04-11T00:00:00.000Z" });
  const newerAsset = buildAsset({ id: "asset-newer", lastUpdatedAt: "2026-04-12T00:00:00.000Z" });

  assert.equal(selectBestAvailableAsset([olderAsset, newerAsset])?.id, "asset-newer");
});

/**
 * Verifies bundle readiness language does not imply nonexistent complete bundles.
 */
test("bundle readiness distinguishes bundle, partial, references-only, and empty states", () => {
  const bundleReadyRecord = getSeedRecord("part-grm188r71c104ka01d");
  const referencesOnlyRecord = getSeedRecord("part-stm32g031k8t6");
  const partialRecord: PartSearchRecord = {
    ...bundleReadyRecord,
    assets: bundleReadyRecord.assets.filter((asset) => asset.assetType === "footprint")
  };
  const emptyRecord: PartSearchRecord = {
    ...bundleReadyRecord,
    assets: []
  };

  assert.equal(getBundleReadinessSummary(bundleReadyRecord).state, "bundle_ready");
  assert.equal(getBundleReadinessSummary(partialRecord).state, "partial_bundle");
  assert.equal(getBundleReadinessSummary(referencesOnlyRecord).state, "references_only");
  assert.equal(getBundleReadinessSummary(emptyRecord).state, "no_usable_assets");
});

/**
 * Verifies source-readiness evaluation stays explicit and source-specific.
 */
test("source-readiness evaluation explains requestable and unavailable generation inputs", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const microcontrollerRecord = getSeedRecord("part-stm32g031k8t6");
  const mechanicalOnlyRecord: PartSearchRecord = {
    ...regulatorRecord,
    datasheetRevision: null
  };

  assert.equal(evaluateGenerationSourceReadiness(regulatorRecord, "symbol").ready, true);
  assert.equal(evaluateGenerationSourceReadiness(microcontrollerRecord, "footprint").ready, true);
  assert.equal(evaluateGenerationSourceReadiness(microcontrollerRecord, "three_d_model").ready, false);
  assert.match(evaluateGenerationSourceReadiness(microcontrollerRecord, "three_d_model").reasons.join(" "), /mechanical drawing/u);
  assert.equal(evaluateGenerationSourceReadiness(mechanicalOnlyRecord, "three_d_model").ready, true);
  assert.equal(evaluateGenerationSourceReadiness(mechanicalOnlyRecord, "three_d_model").sourceDatasheetRevisionId, null);
});

/**
 * Verifies generation options appear for requestable, unavailable, and review workflow targets.
 */
test("generation options follow stored workflow and target readiness state", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const microcontrollerRecord = getSeedRecord("part-stm32g031k8t6");
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const regulatorOptions = getGenerationOptions(regulatorRecord);
  const microcontrollerOptions = getGenerationOptions(microcontrollerRecord);
  const connectorOptions = getGenerationOptions(connectorRecord);

  assert.deepEqual(regulatorOptions.map((option) => option.targetAssetType), ["footprint", "symbol", "three_d_model"]);
  assert.equal(regulatorOptions.find((option) => option.targetAssetType === "symbol")?.workflowStatus, "available_to_request");
  assert.equal(regulatorOptions.find((option) => option.targetAssetType === "three_d_model")?.workflowStatus, "review_required");
  assert.equal(regulatorOptions.find((option) => option.targetAssetType === "three_d_model")?.sourceAssetId, "asset-tps7a02-mechanical");
  assert.equal(microcontrollerOptions.find((option) => option.targetAssetType === "footprint")?.canRequest, true);
  assert.equal(microcontrollerOptions.find((option) => option.targetAssetType === "three_d_model")?.workflowStatus, "unavailable");
  assert.deepEqual(connectorOptions, []);
  assert.equal(resolveAssetClassSummaries(regulatorRecord.assets).find((group) => group.assetType === "datasheet")?.readiness, "reference_only");
});

/**
 * Builds a default footprint asset for ranking tests.
 */
function buildAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    assetState: "validated",
    assetStatus: "verified_for_export",
    assetType: "footprint",
    fileFormat: "kicad_mod",
    fileHash: "sha256:default",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-default",
    lastUpdatedAt: "2026-04-12T00:00:00.000Z",
    licenseMode: "redistribution_allowed",
    partId: "part-test",
    previewStatus: "ready",
    providerId: "test-provider",
    provenance: "manual_internal",
    sourceRecordId: null,
    sourceUrl: null,
    storageKey: "cad/test/default.kicad_mod",
    validationStatus: "verified",
    ...overrides
  };
}

/**
 * Reads one seeded record and fails clearly when fixtures drift.
 */
function getSeedRecord(partId: string): PartSearchRecord {
  const record = getPartDetail(partId);

  assert.ok(record, `expected seed part ${partId}`);
  return record;
}
