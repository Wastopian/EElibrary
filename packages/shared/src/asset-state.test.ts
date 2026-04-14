/**
 * File header: Tests provider-neutral asset state and export availability handling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { deriveAssetState, getExportAvailability, isValidatedDownloadableAsset, withCanonicalAssetTruth } from "./index";
import type { Asset, PartSearchRecord } from "./index";

/** baseAsset supplies a complete asset shape for focused state tests. */
const baseAssetRow = {
  assetState: "missing",
  assetStatus: "missing",
  assetType: "three_d_model",
  fileFormat: "step",
  fileHash: null,
  generationMethod: null,
  generationSourceAssetId: null,
  id: "asset-test",
  lastUpdatedAt: "2026-04-12T00:00:00.000Z",
  licenseMode: "unknown",
  partId: "part-test",
  previewStatus: "not_available",
  providerId: "test-provider",
  provenance: "manual_internal",
  sourceRecordId: "source-test",
  sourceUrl: null,
  storageKey: null,
  validationStatus: "not_validated"
} satisfies Omit<Asset, "availabilityStatus" | "exportStatus" | "reviewStatus">;

/** buildAsset keeps canonical truth fields aligned after individual test overrides. */
function buildAsset(overrides: Partial<Asset> = {}): Asset {
  return withCanonicalAssetTruth({ ...baseAssetRow, ...overrides });
}

/**
 * Verifies asset state derivation does not treat references as downloads.
 */
test("deriveAssetState distinguishes missing, referenced, downloaded, validated, and failed states", () => {
  assert.equal(deriveAssetState({ fileHash: null, sourceUrl: null, storageKey: null, validationStatus: "not_validated" }), "missing");
  assert.equal(deriveAssetState({ fileHash: null, sourceUrl: "https://example.com/model.step", storageKey: null, validationStatus: "needs_review" }), "referenced");
  assert.equal(deriveAssetState({ fileHash: "sha256:test", sourceUrl: null, storageKey: "assets/test.step", validationStatus: "not_validated" }), "downloaded");
  assert.equal(deriveAssetState({ fileHash: "sha256:test", sourceUrl: null, storageKey: "assets/test.step", validationStatus: "verified" }), "validated");
  assert.equal(deriveAssetState({ fileHash: "sha256:test", sourceUrl: null, storageKey: "assets/test.step", validationStatus: "failed" }), "failed");
});

/**
 * Verifies export helpers require validation plus captured file evidence.
 */
test("isValidatedDownloadableAsset requires validated state, storage key, hash, and verified status", () => {
  assert.equal(isValidatedDownloadableAsset(buildAsset({ assetState: "referenced", validationStatus: "needs_review" })), false);
  assert.equal(isValidatedDownloadableAsset(buildAsset({ assetState: "downloaded", fileHash: "sha256:test", storageKey: "assets/test.step", validationStatus: "not_validated" })), false);
  assert.equal(isValidatedDownloadableAsset(buildAsset({ assetState: "validated", assetStatus: "validated", fileHash: "sha256:test", storageKey: "assets/test.step", validationStatus: "verified" })), false);
  assert.equal(isValidatedDownloadableAsset(buildAsset({ assetState: "validated", assetStatus: "verified_for_export", fileHash: null, storageKey: "assets/test.step", validationStatus: "verified" })), false);
  assert.equal(isValidatedDownloadableAsset(buildAsset({ assetState: "validated", assetStatus: "verified_for_export", fileHash: "sha256:test", storageKey: "assets/test.step", validationStatus: "verified" })), true);
});

/**
 * Verifies export availability stays disabled for referenced-only assets.
 */
test("getExportAvailability disables neutral CAD for referenced-only STEP assets", () => {
  const referencedStepAsset = buildAsset({
    assetState: "referenced",
    sourceUrl: "https://example.com/model.step",
    validationStatus: "needs_review"
  });
  const record = buildRecord([referencedStepAsset]);

  assert.equal(getExportAvailability(record).find((action) => action.id === "neutral_cad")?.available, false);
});

/**
 * Builds a minimal joined record for export availability tests.
 */
function buildRecord(assets: Asset[]): PartSearchRecord {
  return {
    assets,
    accessoryRequirements: [],
    buildableMatingSet: {
      bestMate: null,
      cableOptions: [],
      requiredAccessories: [],
      toolingRequirements: []
    },
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    datasheetRevision: null,
    generationRequests: [],
    generationWorkflows: [],
    lastUpdatedAt: "2026-04-12T00:00:00.000Z",
    manufacturer: {
      aliases: [],
      id: "mfr-test",
      name: "Test Manufacturer",
      website: null
    },
    mateRelations: [],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-test",
      packageName: "TEST",
      pinCount: null,
      pitchMm: null
    },
    part: {
      category: "Test",
      connectorFamilyId: null,
      id: "part-test",
      lastUpdatedAt: "2026-04-12T00:00:00.000Z",
      lifecycleStatus: "unknown",
      manufacturerId: "mfr-test",
      mpn: "TEST",
      packageId: "pkg-test",
      trustScore: 0
    },
    reviewRecords: [],
    similarParts: [],
    sources: []
  };
}
