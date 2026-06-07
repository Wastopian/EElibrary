/**
 * File header: Tests UI view-model wording for connector, generation, and export readiness sections.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getGenerationOptions, resolveAssetClassSummaries } from "@ee-library/shared/asset-resolution";
import { getPartDetail } from "@ee-library/shared/search";
import { assetTrustStageTone, formatAssetPromotionBlockers, formatAssetPromotionHistory, formatAssetSourceLabel, formatAssetTrustStageLabel, formatAssetValidationEvidence, formatDatasheetParseConfidence, formatGenerationWorkflowLabel, formatReviewStateLabel, getAssetTruthSummary, getConnectorWorkflowSummary, getPartNextActions, getQuickReadinessSummary, getRecoveryWorkflowSummary, getSearchExportReadiness, reviewStateTone, shouldRenderAssetPromotionAction, shouldRenderConnectorSections, shouldRenderGenerationOptions, shouldRenderReviewActions } from "./detail-view-model";
import { getAssetPromotionSummary, getAssetReviewStatus, getAssetValidationSummary, getWorkflowReviewStatus } from "@ee-library/shared/review-workflow";
import type { Asset, AssetValidationRecord, PartIssueCode } from "@ee-library/shared/types";

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
  assert.match(regulatorOptions.find((option) => option.targetAssetType === "symbol")?.reason ?? "", /extraction confidence/u);
  assert.equal(getGenerationOptions({ ...regulatorRecord, extractionSignals: [] }, regulatorGroups).find((option) => option.targetAssetType === "symbol")?.canRequest, false);
  assert.match(getGenerationOptions({ ...regulatorRecord, extractionSignals: [] }, regulatorGroups).find((option) => option.targetAssetType === "symbol")?.reason ?? "", /No extracted pin table signal/u);
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
  assert.equal(reviewStateTone("approved"), "info");
  assert.equal(reviewStateTone("changes_requested"), "review");
  assert.equal(shouldRenderReviewActions(getAssetReviewStatus(exportVerifiedAsset, connectorRecord.reviewRecords)), false);
});

/**
 * Verifies generated draft asset wording stays review-oriented and non-exportable.
 */
test("generated draft assets use honest source and review wording", () => {
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const sourceAsset = regulatorRecord.assets.find((asset) => asset.assetType === "datasheet");

  assert.ok(sourceAsset, "expected a datasheet source asset to clone");

  const generatedDraftAsset = {
    ...sourceAsset,
    assetState: "downloaded" as const,
    assetStatus: "downloaded" as const,
    assetType: "footprint" as const,
    availabilityStatus: "downloaded" as const,
    exportStatus: "not_exportable" as const,
    fileFormat: "kicad_mod" as const,
    fileHash: "sha256:generated-draft",
    generationMethod: "draft_footprint_from_extraction_signal",
    id: "asset-draft-regulator-footprint",
    licenseMode: "redistribution_allowed" as const,
    provenance: "generated" as const,
    reviewStatus: "review_required" as const,
    storageKey: "generated/drafts/part-tps7a02dbvr/footprint.kicad_mod",
    validationStatus: "needs_review" as const
  };
  const approvedDraftAsset = {
    ...generatedDraftAsset,
    assetStatus: "reviewed" as const,
    reviewStatus: "approved" as const,
    validationStatus: "verified" as const
  };
  const promotedDraftAsset = {
    ...approvedDraftAsset,
    assetState: "validated" as const,
    assetStatus: "verified_for_export" as const,
    availabilityStatus: "validated" as const,
    exportStatus: "verified_for_export" as const
  };
  const validationRecord = buildValidationRecord(approvedDraftAsset, "footprint_geometry");
  const generatedPromotionSummary = getAssetPromotionSummary(generatedDraftAsset, [], []);
  const approvedPromotionSummary = getAssetPromotionSummary(approvedDraftAsset, [validationRecord], []);
  const approvedWithoutEvidenceSummary = getAssetPromotionSummary(approvedDraftAsset, [], []);
  const promotedPromotionSummary = getAssetPromotionSummary(promotedDraftAsset, [validationRecord], []);
  const validationSummary = getAssetValidationSummary(approvedDraftAsset, [validationRecord]);

  assert.equal(formatAssetSourceLabel(generatedDraftAsset, 1), "Best of 1 / generated draft");
  assert.equal(formatAssetTrustStageLabel(generatedDraftAsset, getAssetReviewStatus(generatedDraftAsset, []).state), "generated draft");
  assert.equal(formatAssetTrustStageLabel(approvedDraftAsset, getAssetReviewStatus(approvedDraftAsset, []).state), "approved draft");
  assert.equal(formatAssetTrustStageLabel({ ...generatedDraftAsset, reviewStatus: "rejected", validationStatus: "failed", availabilityStatus: "failed" }, "rejected"), "rejected draft");
  assert.equal(formatAssetTrustStageLabel({ ...generatedDraftAsset, reviewStatus: "changes_requested" }, "changes_requested"), "changes requested");
  assert.equal(formatAssetTrustStageLabel(promotedDraftAsset, getAssetReviewStatus(promotedDraftAsset, []).state), "verified for export");
  assert.equal(assetTrustStageTone(approvedDraftAsset, "approved"), "info");
  assert.equal(formatReviewStateLabel(getAssetReviewStatus(generatedDraftAsset, []).state), "pending review");
  assert.match(formatAssetValidationEvidence(validationSummary), /Footprint geometry/u);
  assert.equal(formatAssetPromotionHistory(approvedPromotionSummary), "No promotion attempts have been recorded.");
  assert.equal(formatAssetPromotionBlockers(approvedPromotionSummary), "Promotion requirements are satisfied.");
  assert.match(formatAssetPromotionBlockers(approvedWithoutEvidenceSummary), /qualifying verified validation evidence/u);
  assert.equal(shouldRenderAssetPromotionAction(generatedPromotionSummary), false);
  assert.equal(shouldRenderAssetPromotionAction(approvedPromotionSummary), true);
  assert.equal(shouldRenderAssetPromotionAction(promotedPromotionSummary), false);
  assert.equal(getSearchExportReadiness({ ...regulatorRecord, assets: [generatedDraftAsset] }).label, "partial package");
});

/**
 * Verifies compact workflow summaries make scan-speed cues honest.
 */
test("search and detail workflow summaries preserve asset and recovery truth", () => {
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const microcontrollerRecord = getSeedRecord("part-stm32g031k8t6");

  assert.equal(getAssetTruthSummary(connectorRecord).label, "2 verified CAD assets");
  assert.match(getAssetTruthSummary(connectorRecord).detail, /only verified files count/u);
  assert.equal(getConnectorWorkflowSummary(connectorRecord)?.label, "connector review needed");
  assert.equal(getConnectorWorkflowSummary(connectorRecord)?.tone, "review");
  assert.match(getConnectorWorkflowSummary(connectorRecord)?.detail ?? "", /assumption/u);
  assert.equal(getRecoveryWorkflowSummary(regulatorRecord).label, "draft output in review");
  assert.match(getRecoveryWorkflowSummary(regulatorRecord).detail, /remain outside export readiness/u);
  assert.equal(getAssetTruthSummary(microcontrollerRecord).label, "no usable CAD files");
  assert.match(getAssetTruthSummary(microcontrollerRecord).detail, /No stored CAD files/u);
});

/**
 * Verifies connector workflow summaries escalate stored connector warnings instead of hiding them in UI-only logic.
 */
test("connector workflow summary reflects structured connector warnings", () => {
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const warningRecord = {
    ...connectorRecord,
    buildableMatingSet: {
      ...connectorRecord.buildableMatingSet,
      warningDetails: [
        {
          code: "near_match_alternates" as const,
          detail: "Two alternate mates remain close enough in confidence to require family review.",
          summary: "High-confidence alternate mates still need family review.",
          tone: "review" as const
        }
      ],
      warnings: ["High-confidence alternate mates still need family review."]
    }
  };

  assert.equal(getConnectorWorkflowSummary(warningRecord)?.label, "connector review needed");
  assert.equal(getConnectorWorkflowSummary(warningRecord)?.tone, "review");
  assert.match(getConnectorWorkflowSummary(warningRecord)?.detail ?? "", /family review/u);
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
  assert.equal(getSearchExportReadiness(footprintOnlyRecord).label, "partial package");
  assert.equal(getSearchExportReadiness(getSeedRecord("part-tps7a02dbvr")).label, "partial package");
  assert.equal(getSearchExportReadiness(getSeedRecord("part-stm32g031k8t6")).label, "links only");
});

/**
 * Verifies quick-check copy is derived from existing export, asset, and workflow signals.
 */
test("quick readiness summary explains blockers without inventing approval state", () => {
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");
  const connectorSummary = getQuickReadinessSummary(connectorRecord);
  const regulatorSummary = getQuickReadinessSummary(regulatorRecord);

  assert.equal(connectorSummary.headline, "Ready for Export Review");
  assert.match(connectorSummary.detail, /Export package: bundle ready/u);
  assert.doesNotMatch(connectorSummary.detail, /approved part/u);
  assert.equal(regulatorSummary.headline, "Blocked");
  assert.ok(regulatorSummary.actions.some((action) => action.label.includes("stored CAD file before export")));
  assert.ok(regulatorSummary.actions.some((action) => action.label.includes("review and approval")));
});

/**
 * Verifies every backend readiness issue gets an honest next action.
 */
test("part next actions cover every readiness issue code", () => {
  const baseRecord = getSeedRecord("part-tps7a02dbvr");
  const issueCodes: PartIssueCode[] = [
    "low_confidence_identity",
    "pending_approval",
    "missing_verified_cad",
    "missing_datasheet",
    "missing_connector_mate",
    "missing_connector_accessories",
    "connector_low_confidence",
    "lifecycle_risk",
    "source_conflict",
    "duplicate_candidate"
  ];
  const record = {
    ...baseRecord,
    issues: issueCodes.map((code, index) => ({
      assignedTo: null,
      code,
      detail: `Detail for ${code}.`,
      id: `issue-${code}`,
      lastUpdatedAt: "2026-04-29T00:00:00.000Z",
      partId: baseRecord.part.id,
      resolutionNotes: null,
      resolvedAt: null,
      severity: index % 2 === 0 ? "error" as const : "warning" as const,
      source: "test",
      status: "open" as const,
      summary: `Summary for ${code}.`
    }))
  };
  const actions = getPartNextActions(record);

  assert.deepEqual(actions.map((action) => action.id), issueCodes);
  assert.equal(actions[0]?.priority, "primary");
  assert.ok(actions.every((action) => action.label.length > 0));
  assert.ok(actions.every((action) => action.href.length > 0));
  assert.ok(actions.every((action) => action.available === true));
});

/**
 * Reads one seeded detail record and fails loudly when the fixture changes.
 */
function getSeedRecord(partId: string) {
  const record = getPartDetail(partId);

  assert.ok(record, `expected seed part ${partId}`);
  return record;
}

/**
 * Builds validation evidence strong enough for promotion UI eligibility tests.
 */
function buildValidationRecord(asset: Asset, validationType: AssetValidationRecord["validationType"]): AssetValidationRecord {
  return {
    assetId: asset.id,
    id: `validation-${asset.id}`,
    lastUpdatedAt: "2026-04-13T00:00:00.000Z",
    partId: asset.partId,
    validatedAt: "2026-04-13T00:00:00.000Z",
    validationNotes: "UI test validation evidence.",
    validationStatus: "verified",
    validationType,
    validator: "ui-test-validator"
  };
}
