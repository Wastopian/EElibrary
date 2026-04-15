/**
 * File header: Tests review status resolution and export verification transition rules.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { withCanonicalAssetTruth } from "./asset-state";
import { applyAssetReviewOutcome, applyWorkflowReviewOutcome, canAssetBecomeVerifiedForExport, canPromoteAssetToVerifiedForExport, getAssetPromotionBlockers, getAssetPromotionSummary, getAssetReviewStatus, getAssetValidationSummary, getWorkflowReviewStatus, promoteAssetToVerifiedForExport } from "./review-workflow";
import type { Asset, AssetPromotionAuditRecord, AssetValidationRecord, GenerationWorkflow, ReviewRecord } from "./types";

/** reviewedAt keeps review fixture ordering deterministic. */
const reviewedAt = "2026-04-13T00:00:00.000Z";

/**
 * Verifies approval does not automatically promote eligible file-backed CAD assets.
 */
test("asset approval keeps export verification as a separate promotion step", () => {
  const generatedStep = buildAsset({
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType: "three_d_model",
    fileHash: "sha256:generated-step",
    licenseMode: "redistribution_allowed",
    provenance: "generated",
    storageKey: "generated/model.step",
    validationStatus: "needs_review"
  });
  const approvedStep = applyAssetReviewOutcome(generatedStep, "approved");
  const referencedDatasheet = buildAsset({
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    licenseMode: "metadata_only",
    sourceUrl: "https://example.com/datasheet.pdf",
    validationStatus: "needs_review"
  });

  assert.equal(canAssetBecomeVerifiedForExport(generatedStep, "approved"), false);
  assert.equal(approvedStep.assetStatus, "reviewed");
  assert.equal(approvedStep.reviewStatus, "approved");
  assert.equal(approvedStep.exportStatus, "not_exportable");
  assert.equal(canAssetBecomeVerifiedForExport(referencedDatasheet, "approved"), false);
  assert.equal(applyAssetReviewOutcome(referencedDatasheet, "approved").assetStatus, "reviewed");
});

/**
 * Verifies explicit promotion is required before an approved draft becomes export-verified.
 */
test("asset promotion verifies export only after explicit review and promotion rules pass", () => {
  const generatedFootprint = buildAsset({
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType: "footprint",
    fileFormat: "kicad_mod",
    fileHash: "sha256:generated-footprint",
    licenseMode: "redistribution_allowed",
    provenance: "generated",
    storageKey: "generated/footprint.kicad_mod",
    validationStatus: "needs_review"
  });
  const approvedFootprint = applyAssetReviewOutcome(generatedFootprint, "approved");
  const validation = buildValidationRecord({
    assetId: approvedFootprint.id,
    partId: approvedFootprint.partId,
    validationType: "footprint_geometry"
  });
  const promotedFootprint = promoteAssetToVerifiedForExport(approvedFootprint, [validation]);

  assert.equal(canPromoteAssetToVerifiedForExport(generatedFootprint), false);
  assert.match(getAssetPromotionBlockers(generatedFootprint).join(" "), /approved review/u);
  assert.equal(canPromoteAssetToVerifiedForExport(approvedFootprint), false);
  assert.match(getAssetPromotionBlockers(approvedFootprint).join(" "), /qualifying verified validation evidence/u);
  assert.equal(canPromoteAssetToVerifiedForExport(approvedFootprint, [validation]), true);
  assert.equal(promotedFootprint.assetStatus, "verified_for_export");
  assert.equal(promotedFootprint.availabilityStatus, "validated");
  assert.equal(promotedFootprint.exportStatus, "verified_for_export");
});

/**
 * Verifies validation and promotion summaries expose evidence and audit blockers directly.
 */
test("validation and promotion summaries expose latest evidence and blockers", () => {
  const approvedSymbol = applyAssetReviewOutcome(
    buildAsset({
      assetState: "downloaded",
      assetStatus: "downloaded",
      assetType: "symbol",
      fileFormat: "kicad_sym",
      fileHash: "sha256:symbol",
      licenseMode: "redistribution_allowed",
      storageKey: "generated/symbol.kicad_sym",
      validationStatus: "needs_review"
    }),
    "approved"
  );
  const validation = buildValidationRecord({
    assetId: approvedSymbol.id,
    partId: approvedSymbol.partId,
    validationType: "symbol_pin_mapping",
    validator: "test-validator"
  });
  const audit = buildPromotionAudit({
    assetId: approvedSymbol.id,
    partId: approvedSymbol.partId,
    promotionOutcome: "denied"
  });

  assert.match(getAssetValidationSummary(approvedSymbol, [validation]).reason, /Symbol pin mapping by test-validator/u);
  assert.equal(getAssetPromotionSummary(approvedSymbol, [validation], [audit]).canPromote, true);
  assert.equal(getAssetPromotionSummary(approvedSymbol, [], [audit]).canPromote, false);
  assert.match(getAssetPromotionSummary(approvedSymbol, [], [audit]).blockerReasons.join(" "), /qualifying verified validation evidence/u);
  assert.equal(getAssetPromotionSummary(approvedSymbol, [validation], [audit]).latestPromotion?.promotionOutcome, "denied");
});

/**
 * Verifies rejected and changes-requested outcomes stay non-exportable.
 */
test("asset review transitions keep rejected and changes-requested assets out of export", () => {
  const downloadedFootprint = buildAsset({
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType: "footprint",
    fileHash: "sha256:footprint",
    licenseMode: "redistribution_allowed",
    storageKey: "generated/footprint.kicad_mod",
    validationStatus: "needs_review"
  });

  assert.equal(applyAssetReviewOutcome(downloadedFootprint, "rejected").assetStatus, "failed");
  assert.equal(applyAssetReviewOutcome(downloadedFootprint, "rejected").validationStatus, "failed");
  assert.equal(applyAssetReviewOutcome(downloadedFootprint, "changes_requested").assetStatus, "reviewed");
  assert.equal(applyAssetReviewOutcome(downloadedFootprint, "changes_requested").validationStatus, "needs_review");
});

/**
 * Verifies review status resolution uses explicit latest review rows before inferred state.
 */
test("review status resolution uses latest explicit review state", () => {
  const pendingAsset = buildAsset({ assetState: "downloaded", assetStatus: "downloaded", provenance: "generated", validationStatus: "needs_review" });
  const approvedReview = buildReview({ assetId: pendingAsset.id, outcome: "approved", reviewedAt: "2026-04-13T00:00:00.000Z" });
  const changesReview = buildReview({ assetId: pendingAsset.id, id: "review-asset-changes", outcome: "changes_requested", reviewedAt: "2026-04-14T00:00:00.000Z" });

  assert.equal(getAssetReviewStatus(pendingAsset, []).state, "pending_review");
  assert.equal(getAssetReviewStatus(pendingAsset, [approvedReview, changesReview]).state, "changes_requested");
});

/**
 * Verifies workflow review transitions are separate from output asset export verification.
 */
test("workflow review transitions do not imply output asset export verification", () => {
  const workflow: GenerationWorkflow = {
    confidenceScore: 0.75,
    generationStatus: "review_required",
    id: "workflow-test",
    outputAssetId: "asset-test",
    partId: "part-test",
    sourceAssetId: null,
    sourceDatasheetRevisionId: null,
    targetAssetType: "three_d_model"
  };

  assert.equal(getWorkflowReviewStatus(workflow, []).state, "pending_review");
  assert.equal(applyWorkflowReviewOutcome(workflow, "approved").generationStatus, "approved");
  assert.equal(applyWorkflowReviewOutcome(workflow, "rejected").generationStatus, "failed");
  assert.equal(applyWorkflowReviewOutcome(workflow, "changes_requested").generationStatus, "review_required");
});

/**
 * Builds an asset fixture for review workflow tests.
 */
function buildAsset(overrides: Partial<Asset>): Asset {
  return withCanonicalAssetTruth({
    assetState: "missing",
    assetStatus: "missing",
    assetType: "three_d_model",
    fileFormat: "step",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-test",
    lastUpdatedAt: reviewedAt,
    licenseMode: "unknown",
    partId: "part-test",
    previewStatus: "not_available",
    providerId: "test-provider",
    provenance: "manual_internal",
    sourceRecordId: null,
    sourceUrl: null,
    storageKey: null,
    validationStatus: "not_validated",
    ...overrides
  });
}

/**
 * Builds a review record fixture for review status tests.
 */
function buildReview(overrides: Partial<ReviewRecord>): ReviewRecord {
  return {
    assetId: "asset-test",
    generationWorkflowId: null,
    id: "review-asset-approved",
    lastUpdatedAt: reviewedAt,
    notes: null,
    outcome: "approved",
    partId: "part-test",
    reviewedAt,
    reviewer: "test-reviewer",
    targetType: "asset",
    ...overrides
  };
}

/**
 * Builds a validation evidence fixture for promotion-rule tests.
 */
function buildValidationRecord(overrides: Partial<AssetValidationRecord>): AssetValidationRecord {
  return {
    assetId: "asset-test",
    id: "validation-test",
    lastUpdatedAt: reviewedAt,
    partId: "part-test",
    validatedAt: reviewedAt,
    validationNotes: "Test validation evidence.",
    validationStatus: "verified",
    validationType: "manual_engineering_review",
    validator: "test-validator",
    ...overrides
  };
}

/**
 * Builds a promotion audit fixture for summary tests.
 */
function buildPromotionAudit(overrides: Partial<AssetPromotionAuditRecord>): AssetPromotionAuditRecord {
  return {
    actor: "test-actor",
    assetId: "asset-test",
    blockerReasons: ["test blocker"],
    createdAt: reviewedAt,
    id: "promotion-test",
    newExportStatus: "not_exportable",
    partId: "part-test",
    priorExportStatus: "not_exportable",
    promotionOutcome: "denied",
    validationRecordId: null,
    ...overrides
  };
}
