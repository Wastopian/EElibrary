/**
 * File header: Tests UI view-model wording for connector, generation, and export readiness sections.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getGenerationOptions, resolveAssetClassSummaries } from "@ee-library/shared/asset-resolution";
import { getPartDetail } from "@ee-library/shared/search";
import { formatDatasheetParseConfidence, formatGenerationWorkflowLabel, getSearchExportReadiness, shouldRenderConnectorSections, shouldRenderGenerationOptions } from "./detail-view-model";

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
