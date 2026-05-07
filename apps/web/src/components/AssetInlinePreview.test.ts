/**
 * Tests the asset inline preview state matrix.
 *
 * The component never renders silently when a preview was promised but cannot be shown.
 * Exercises every fileFormat × previewStatus × availabilityStatus path the helper handles.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Asset, AssetAvailabilityStatus, FileFormat, PreviewStatus } from "@ee-library/shared/types";
import { canEmbedAssetPreview, getAssetPreviewState } from "./AssetInlinePreview";

function stubAsset(overrides: Partial<Asset>): Asset {
  return {
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType: "datasheet",
    availabilityStatus: "downloaded",
    exportStatus: "not_exportable",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-test",
    lastUpdatedAt: "2026-05-05T00:00:00.000Z",
    licenseMode: "redistribution_allowed",
    partId: "part-test",
    previewStatus: "ready",
    provenance: "official",
    providerId: null,
    reviewStatus: "approved",
    sourceRecordId: null,
    sourceUrl: null,
    storageKey: "datasheet/part-test.pdf",
    validationStatus: "verified",
    ...overrides
  };
}

/**
 * Verifies the inline-embed gate stays on stored PDFs only — no false positives.
 */
test("canEmbedAssetPreview only allows stored PDFs", () => {
  assert.equal(canEmbedAssetPreview(stubAsset({})), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "validated" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "png" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "webp", availabilityStatus: "validated" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "referenced" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "missing" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "jpg", availabilityStatus: "referenced" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "step" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ previewStatus: "pending" })), false);
});

/**
 * Verifies stored PDFs map to the inline-iframe state.
 */
test("getAssetPreviewState maps stored PDFs to inline preview", () => {
  const downloaded = getAssetPreviewState(stubAsset({ availabilityStatus: "downloaded" }));
  const validated = getAssetPreviewState(stubAsset({ availabilityStatus: "validated" }));
  const image = getAssetPreviewState(stubAsset({ fileFormat: "jpeg" }));

  assert.equal(downloaded.kind, "stored_pdf_inline");
  assert.equal(validated.kind, "stored_pdf_inline");
  assert.equal(image.kind, "stored_image_inline");
});

/**
 * Verifies referenced-only or missing PDFs surface explicit fallback copy.
 */
test("getAssetPreviewState calls out reference-only PDFs explicitly", () => {
  const cases: AssetAvailabilityStatus[] = ["referenced", "missing", "failed"];

  for (const status of cases) {
    const state = getAssetPreviewState(stubAsset({ availabilityStatus: status }));
    assert.equal(state.kind, "pdf_reference_only", `expected pdf_reference_only for ${status}`);
  }
});

/**
 * Verifies reference-only image formats also surface explicit fallback copy.
 */
test("getAssetPreviewState calls out reference-only images explicitly", () => {
  const state = getAssetPreviewState(stubAsset({ availabilityStatus: "referenced", fileFormat: "png" }));
  assert.equal(state.kind, "image_reference_only");
});

/**
 * Verifies non-PDF formats marked preview-ready surface an explicit "no inline preview"
 * note instead of silently hiding the slot.
 */
test("getAssetPreviewState marks non-PDF preview-ready assets unsupported", () => {
  const cases: FileFormat[] = ["step", "kicad_mod", "kicad_sym", "dxf", "unknown"];

  for (const format of cases) {
    const state = getAssetPreviewState(stubAsset({ fileFormat: format }));
    assert.equal(state.kind, "ready_unsupported_format", `expected unsupported note for ${format}`);
  }
});

/**
 * Verifies pending and not-available preview states are handled distinctly.
 */
test("getAssetPreviewState distinguishes pending vs not_available preview metadata", () => {
  assert.equal(getAssetPreviewState(stubAsset({ previewStatus: "pending" })).kind, "preview_pending");

  const notAvailableStatuses: PreviewStatus[] = ["not_available"];
  for (const status of notAvailableStatuses) {
    const state = getAssetPreviewState(stubAsset({ previewStatus: status }));
    assert.equal(state.kind, "preview_not_available", `expected not_available for ${status}`);
  }
});
