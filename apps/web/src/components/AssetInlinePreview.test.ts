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
    previewArtifactFormat: "pdf",
    previewArtifactGeneratedAt: null,
    previewArtifactSource: "source_native",
    previewArtifactStorageKey: "datasheet/part-test.pdf",
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
 * Verifies the inline-embed gate stays on stored PDFs, stored images, and 3D models with
 * a derived viewer artifact — no false positives. STEP without a derived artifact must
 * stay download-only so we never claim an inline 3D preview that does not exist.
 */
test("canEmbedAssetPreview only allows stored PDFs, stored images, and 3D with derived artifact", () => {
  assert.equal(canEmbedAssetPreview(stubAsset({})), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "validated" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "png" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "webp", availabilityStatus: "validated" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "referenced" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "missing" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "jpg", availabilityStatus: "referenced" })), false);

  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "step" })), false);
  assert.equal(
    canEmbedAssetPreview(
      stubAsset({
        fileFormat: "step",
        previewArtifactFormat: "glb",
        previewArtifactStorageKey: "cad/step/part-test/preview.glb",
        previewArtifactSource: "converter_step_to_gltf"
      })
    ),
    true
  );
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
 * Verifies non-PDF, non-3D formats marked preview-ready surface an explicit "no inline
 * preview" note instead of silently hiding the slot. STEP/glb/gltf are excluded because
 * they have their own dedicated inline-3D / pending-artifact branches.
 */
test("getAssetPreviewState marks non-PDF, non-3D preview-ready assets unsupported", () => {
  const cases: FileFormat[] = ["kicad_mod", "kicad_sym", "dxf", "unknown"];

  for (const format of cases) {
    const state = getAssetPreviewState(stubAsset({ fileFormat: format }));
    assert.equal(state.kind, "ready_unsupported_format", `expected unsupported note for ${format}`);
  }
});

/**
 * Verifies a STEP asset that is preview-ready *but* has no derived viewer artifact
 * recorded surfaces the explicit "preview pending artifact" branch — never the inline
 * 3D viewer (which would silently render nothing) and never `ready_unsupported_format`
 * (which would hide the fact that conversion is the missing step).
 */
test("getAssetPreviewState reports STEP without a derived artifact as three_d_preview_pending_artifact", () => {
  const noArtifactKey = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: null,
      previewArtifactStorageKey: null,
      previewArtifactSource: null
    })
  );
  assert.equal(noArtifactKey.kind, "three_d_preview_pending_artifact");

  const artifactKeyWithoutFormat = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: null,
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf"
    })
  );
  assert.equal(artifactKeyWithoutFormat.kind, "three_d_preview_pending_artifact");

  const formatButNoKey = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: null,
      previewArtifactSource: "converter_step_to_gltf"
    })
  );
  assert.equal(formatButNoKey.kind, "three_d_preview_pending_artifact");
});

/**
 * Verifies a STEP asset that is preview-ready and has a glb/gltf derived artifact
 * recorded surfaces the inline 3D viewer state with the embeddable format echoed back
 * to the renderer. A "step" preview-artifact format must be rejected — that would mean
 * the writer attempted to use the source bytes as the viewer artifact, which the
 * <model-viewer> mount cannot decode.
 */
test("getAssetPreviewState routes STEP with a glb/gltf artifact to stored_three_d_inline", () => {
  const glb = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf"
    })
  );
  assert.equal(glb.kind, "stored_three_d_inline");
  if (glb.kind === "stored_three_d_inline") {
    assert.equal(glb.previewArtifactFormat, "glb");
  }

  const gltf = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: "gltf",
      previewArtifactStorageKey: "cad/step/part-test/preview.gltf",
      previewArtifactSource: "converter_step_to_gltf"
    })
  );
  assert.equal(gltf.kind, "stored_three_d_inline");

  // A glb source format with a glb derived artifact still flows through the same
  // viewer path (no conversion needed but the discipline is identical).
  const glbSource = getAssetPreviewState(
    stubAsset({
      fileFormat: "glb",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: "cad/glb/part-test/preview.glb",
      previewArtifactSource: "source_native"
    })
  );
  assert.equal(glbSource.kind, "stored_three_d_inline");
});

/**
 * Verifies the inline 3D path stays gated by `previewStatus`. A STEP with a derived
 * artifact recorded but `previewStatus = pending` must surface the pending state, never
 * the viewer — otherwise we would render a stale artifact while the worker is still
 * iterating on the source.
 */
test("getAssetPreviewState gates the inline 3D viewer behind previewStatus", () => {
  const pendingState = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf",
      previewStatus: "pending"
    })
  );
  assert.equal(pendingState.kind, "preview_pending");

  const notAvailableState = getAssetPreviewState(
    stubAsset({
      fileFormat: "step",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf",
      previewStatus: "not_available"
    })
  );
  assert.equal(notAvailableState.kind, "preview_not_available");
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
