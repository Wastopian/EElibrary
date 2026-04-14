/**
 * File header: Tests UI view-model wording for connector, generation, and export readiness sections.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getGenerationOptions, resolveAssetClassSummaries } from "@ee-library/shared/asset-resolution";
import { getPartDetail } from "@ee-library/shared/search";
import { formatDatasheetParseConfidence, formatGenerationWorkflowLabel, formatReviewStateLabel, getSearchExportReadiness, reviewStateTone, shouldRenderConnectorSections, shouldRenderGenerationOptions, shouldRenderReviewActions } from "./detail-view-model";
import { getAssetReviewStatus, getWorkflowReviewStatus } from "@ee-library/shared/review-workflow";

/**
 * Verifies connector section visibility follows connector data presence.
 */
test("connector section visibility follows connector intelligence data", () => {
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const nonConnectorRecord = {
    ...connectorRecord,
    accessoryRequirements: [],
    cableCompatibilities: [],
    connectorFamily: null,
    mateRelations: []
  };

  assert.equal(shouldRenderConnectorSections(connectorRecord), true);
  assert.equal(shouldRenderConnectorSections(nonConnectorRecord), false);
});

/**
 * Verifies missing datasheet parse confidence is not displayed as zero confidence.
 */
test("missing datasheet parse confidence uses explicit missing wording", () => {
  assert.equal(formatDatasheetParseConfidence(undefined), "No parse confidence");
  assert.equal(formatDatasheetParseConfidence(null), "No parse confidence");
  assert.equal(formatDatasheetParseConfidence(0.82), "82% parse confidence");
});

/**
 * Verifies generation workflow wording distinguishes planned from generated outputs.
 */
test("generation workflow wording distinguishes planned and generated outputs", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const readyWorkflow = regulatorRecord.generationWorkflows.find((workflow) => workflow.targetAssetType === "footprint");

  assert.ok(readyWorkflow, "expected seeded generation workflow");
  assert.match(formatGenerationWorkflowLabel(readyWorkflow, regulatorRecord.assets), /planned output/u);
  assert.match(formatGenerationWorkflowLabel({ ...readyWorkflow, generationStatus: "review_required" }, regulatorRecord.assets), /review output/u);
});

/**
 * Verifies missing-asset fallback actions render only from stored workflows.
 */
test("generation option visibility follows stored missing-asset workflows", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const regulatorGroups = resolveAssetClassSummaries(regulatorRecord.assets);
  const connectorGroups = resolveAssetClassSummaries(connectorRecord.assets);
  const regulatorOptions = getGenerationOptions(regulatorRecord, regulatorGroups);
  const connectorOptions = getGenerationOptions(connectorRecord, connectorGroups);

  assert.equal(shouldRenderGenerationOptions(regulatorOptions), true);
  assert.equal(shouldRenderGenerationOptions(connectorOptions), false);
  assert.deepEqual(regulatorOptions.map((option) => option.label), ["Generate footprint from datasheet", "Generate symbol from pin table", "Generate 3D from mechanical drawing"]);
  assert.deepEqual(regulatorOptions.map((option) => option.workflowStatusLabel), ["request available", "request available", "in review"]);
});

/**
 * Verifies engineering asset grouping exposes every first-class class with honest missing states.
 */
test("engineering asset grouping exposes first-class sections and missing states", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const groups = resolveAssetClassSummaries(regulatorRecord.assets);

  assert.deepEqual(groups.map((group) => group.assetType), ["symbol", "footprint", "three_d_model", "datasheet", "mechanical_drawing"]);
  assert.equal(groups.find((group) => group.assetType === "footprint")?.readiness, "missing");
  assert.equal(groups.find((group) => group.assetType === "three_d_model")?.readiness, "downloaded_file");
  assert.equal(groups.find((group) => group.assetType === "mechanical_drawing")?.readiness, "reference_only");
});

/**
 * Verifies review wording keeps generated, reviewed, and export-verified states distinct.
 */
test("review status wording distinguishes pending, approved, rejected, and export-verified states", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const microcontrollerRecord = getSeedRecord("part-stm32g031k8t6");
  const pendingGeneratedAsset = regulatorRecord.assets.find((asset) => asset.id === "asset-tps7a02-3d");
  const approvedNotExportAsset = connectorRecord.assets.find((asset) => asset.id === "asset-te-215079-8-3d");
  const rejectedAsset = microcontrollerRecord.assets.find((asset) => asset.id === "asset-stm32g031-3d");
  const exportVerifiedAsset = connectorRecord.assets.find((asset) => asset.id === "asset-te-215079-8-footprint");
  const reviewWorkflow = regulatorRecord.generationWorkflows.find((workflow) => workflow.id === "gen-tps7a02-3d");

  assert.ok(pendingGeneratedAsset, "expected generated pending review asset");
  assert.ok(approvedNotExportAsset, "expected approved but not export-verified asset");
  assert.ok(rejectedAsset, "expected rejected asset");
  assert.ok(exportVerifiedAsset, "expected verified-for-export asset");
  assert.ok(reviewWorkflow, "expected review-required generation workflow");
  assert.equal(formatReviewStateLabel(getAssetReviewStatus(pendingGeneratedAsset, regulatorRecord.reviewRecords).state), "pending review");
  assert.equal(formatReviewStateLabel(getAssetReviewStatus(approvedNotExportAsset, connectorRecord.reviewRecords).state), "approved");
  assert.equal(formatReviewStateLabel(getAssetReviewStatus(rejectedAsset, microcontrollerRecord.reviewRecords).state), "rejected");
  assert.equal(formatReviewStateLabel(getAssetReviewStatus(exportVerifiedAsset, connectorRecord.reviewRecords).state), "verified for export");
  assert.equal(formatReviewStateLabel(getWorkflowReviewStatus(reviewWorkflow, regulatorRecord.reviewRecords).state), "pending review");
  assert.equal(reviewStateTone("changes_requested"), "review");
  assert.equal(shouldRenderReviewActions(getAssetReviewStatus(exportVerifiedAsset, connectorRecord.reviewRecords)), false);
});

/**
 * Verifies search export labels use precise bundle readiness language.
 */
test("search export readiness labels distinguish bundles from single verified CAD assets", () => {
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const footprintOnlyRecord = {
    ...connectorRecord,
    assets: connectorRecord.assets.filter((asset) => asset.assetType === "footprint")
  };

  assert.equal(getSearchExportReadiness(connectorRecord).label, "bundle ready");
  assert.equal(getSearchExportReadiness(footprintOnlyRecord).label, "partial bundle");
  assert.equal(getSearchExportReadiness(getSeedRecord("part-tps7a02dbvr")).label, "partial bundle");
  assert.equal(getSearchExportReadiness(getSeedRecord("part-stm32g031k8t6")).label, "references only");
});

/**
 * Reads one seeded detail record and fails loudly when the fixture changes.
 */
function getSeedRecord(partId: string) {
  const record = getPartDetail(partId);

  assert.ok(record, `expected seed part ${partId}`);
  return record;
}
