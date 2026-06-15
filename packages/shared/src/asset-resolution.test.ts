/**
 * File header: Tests seed-free asset ranking, bundle readiness, and generation option helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getPartDetail } from "./search";
import { withCanonicalAssetTruth } from "./asset-state";
import { evaluateGenerationSourceReadiness, getBundleReadinessSummary, getGenerationOptions, resolveAssetClassSummaries, selectBestAvailableAsset } from "./asset-resolution";
import { getExportAvailability } from "./catalog-runtime";
import { applyAssetReviewOutcome, promoteAssetToVerifiedForExport } from "./review-workflow";
import type { Asset, AssetValidationRecord, PartSearchRecord } from "./types";

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
 * Verifies generated draft CAD does not enable export actions before review and verification.
 */
test("generated review-required drafts do not satisfy export gating", () => {
  const baseRecord = getSeedRecord("part-grm188r71c104ka01d");
  const generatedFootprint = buildGeneratedDraftAsset("asset-draft-footprint", "footprint", "kicad_mod");
  const generatedSymbol = buildGeneratedDraftAsset("asset-draft-symbol", "symbol", "kicad_sym");
  const approvedFootprint = applyAssetReviewOutcome(generatedFootprint, "approved");
  const approvedSymbol = applyAssetReviewOutcome(generatedSymbol, "approved");
  const validationRecords = [buildValidationRecord(approvedFootprint, "footprint_geometry"), buildValidationRecord(approvedSymbol, "symbol_pin_mapping")];
  const promotedRecord: PartSearchRecord = {
    ...baseRecord,
    assets: [promoteAssetToVerifiedForExport(approvedFootprint, validationRecords), promoteAssetToVerifiedForExport(approvedSymbol, validationRecords)],
    validationRecords
  };
  const draftRecord: PartSearchRecord = {
    ...baseRecord,
    assets: [generatedFootprint, generatedSymbol]
  };
  const approvedDraftRecord: PartSearchRecord = {
    ...baseRecord,
    assets: [approvedFootprint, approvedSymbol]
  };

  assert.deepEqual(
    getExportAvailability(draftRecord).map((action) => [action.id, action.available]),
    [
      ["altium", false],
      ["solidworks", false],
      ["neutral_cad", false]
    ]
  );
  assert.equal(getBundleReadinessSummary(draftRecord).state, "partial_bundle");
  assert.equal(getExportAvailability(approvedDraftRecord).find((action) => action.id === "altium")?.available, false);
  assert.equal(getExportAvailability(promotedRecord).find((action) => action.id === "altium")?.available, true);
});

/**
 * Verifies source-readiness evaluation stays explicit and source-specific.
 */
test("source-readiness evaluation explains requestable and unavailable generation inputs", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const microcontrollerRecord = getSeedRecord("part-stm32g031k8t6");
  const mechanicalOnlyRecord: PartSearchRecord = {
    ...regulatorRecord,
    datasheetRevision: null,
    extractionSignals: regulatorRecord.extractionSignals.map((signal) => (signal.signalType === "mechanical_drawing" ? { ...signal, datasheetRevisionId: null } : signal))
  };

  assert.equal(evaluateGenerationSourceReadiness(regulatorRecord, "symbol").ready, true);
  assert.deepEqual(evaluateGenerationSourceReadiness(regulatorRecord, "symbol").extractionSignalIds, ["sig-tps7a02-pin-table"]);
  assert.match(evaluateGenerationSourceReadiness(regulatorRecord, "symbol").reasons.join(" "), /74% extraction confidence/u);
  assert.equal(evaluateGenerationSourceReadiness(microcontrollerRecord, "footprint").ready, true);
  assert.equal(evaluateGenerationSourceReadiness(microcontrollerRecord, "three_d_model").ready, false);
  assert.match(evaluateGenerationSourceReadiness(microcontrollerRecord, "three_d_model").reasons.join(" "), /Mechanical drawing extraction is not available/u);
  assert.equal(evaluateGenerationSourceReadiness(mechanicalOnlyRecord, "three_d_model").ready, true);
  assert.equal(evaluateGenerationSourceReadiness(mechanicalOnlyRecord, "three_d_model").sourceDatasheetRevisionId, null);
  assert.equal(evaluateGenerationSourceReadiness({ ...regulatorRecord, extractionSignals: [] }, "symbol").ready, false);
  assert.match(evaluateGenerationSourceReadiness({ ...regulatorRecord, extractionSignals: [] }, "symbol").reasons.join(" "), /No extracted pin table signal/u);
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
 * Verifies reviewed workflows are not masked by stale linked request rows.
 */
test("generation options prefer terminal workflow state over a stale linked request", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const approvedWorkflowRecord: PartSearchRecord = {
    ...regulatorRecord,
    generationRequests: regulatorRecord.generationRequests.map((request) =>
      request.targetAssetType === "three_d_model" ? { ...request, requestStatus: "review_required" } : request
    ),
    generationWorkflows: regulatorRecord.generationWorkflows.map((workflow) =>
      workflow.targetAssetType === "three_d_model" ? { ...workflow, generationStatus: "approved" } : workflow
    )
  };

  const option = getGenerationOptions(approvedWorkflowRecord).find((candidate) => candidate.targetAssetType === "three_d_model");

  assert.equal(option?.workflowStatus, "approved");
  assert.equal(option?.workflowStatusLabel, "approved");
});

/**
 * Builds a default footprint asset for ranking tests.
 */
function buildAsset(overrides: Partial<Asset> = {}): Asset {
  return withCanonicalAssetTruth({
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
  });
}

/**
 * Builds a generated draft CAD asset that is file-backed but not export verified.
 */
function buildGeneratedDraftAsset(id: string, assetType: "footprint" | "symbol", fileFormat: "kicad_mod" | "kicad_sym"): Asset {
  return {
    ...buildAsset({
      assetType,
      fileFormat,
      id,
      storageKey: `generated/drafts/part-test/${assetType}.${fileFormat}`
    }),
    assetState: "downloaded",
    assetStatus: "downloaded",
    availabilityStatus: "downloaded",
    exportStatus: "not_exportable",
    generationMethod: `draft_${assetType}_from_extraction_signal`,
    provenance: "generated",
    reviewStatus: "review_required",
    validationStatus: "needs_review"
  };
}

/**
 * Builds validation evidence that is strong enough to support explicit promotion.
 */
function buildValidationRecord(asset: Asset, validationType: AssetValidationRecord["validationType"]): AssetValidationRecord {
  return {
    assetId: asset.id,
    id: `validation-${asset.id}`,
    lastUpdatedAt: "2026-04-13T00:00:00.000Z",
    partId: asset.partId,
    validatedAt: "2026-04-13T00:00:00.000Z",
    validationNotes: "Test validation evidence.",
    validationStatus: "verified",
    validationType,
    validator: "test-validator"
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
