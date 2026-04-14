/**
 * File header: Tests review status resolution and export verification transition rules.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { applyAssetReviewOutcome, applyWorkflowReviewOutcome, canAssetBecomeVerifiedForExport, getAssetReviewStatus, getWorkflowReviewStatus } from "./review-workflow";
import type { Asset, GenerationWorkflow, ReviewRecord } from "./types";

/** reviewedAt keeps review fixture ordering deterministic. */
const reviewedAt = "2026-04-13T00:00:00.000Z";

/**
 * Verifies approval only promotes eligible file-backed CAD assets to verified_for_export.
 */
test("asset approval verifies export only for eligible file-backed CAD assets", () => {
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
  const referencedDatasheet = buildAsset({
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    licenseMode: "metadata_only",
    sourceUrl: "https://example.com/datasheet.pdf",
    validationStatus: "needs_review"
  });

  assert.equal(canAssetBecomeVerifiedForExport(generatedStep, "approved"), true);
  assert.equal(applyAssetReviewOutcome(generatedStep, "approved").assetStatus, "verified_for_export");
  assert.equal(canAssetBecomeVerifiedForExport(referencedDatasheet, "approved"), false);
  assert.equal(applyAssetReviewOutcome(referencedDatasheet, "approved").assetStatus, "reviewed");
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
  return {
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
  };
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
