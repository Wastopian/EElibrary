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
 * Verifies the inline-embed gate covers stored PDFs, stored images, 3D models with a derived
 * viewer artifact, and STEP source files on disk (rendered in-browser). A reference-only STEP
 * with no stored bytes and no artifact must stay download-only so we never claim an inline 3D
 * preview that does not exist.
 */
test("canEmbedAssetPreview allows stored PDFs, images, derived 3D artifacts, and stored STEP source", () => {
  assert.equal(canEmbedAssetPreview(stubAsset({})), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "validated" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "png" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "webp", availabilityStatus: "validated" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "referenced" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ availabilityStatus: "missing" })), false);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "jpg", availabilityStatus: "referenced" })), false);

  // A STEP source on disk embeds via the in-browser viewer, with or without a derived artifact.
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "step" })), true);
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "step", availabilityStatus: "validated" })), true);
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
  // Reference-only STEP (no stored bytes, no artifact) stays download-only.
  assert.equal(canEmbedAssetPreview(stubAsset({ fileFormat: "step", availabilityStatus: "referenced" })), false);
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
 * Verifies a STEP source file on disk renders inline via the in-browser viewer even when no
 * derived glb/gltf artifact exists — the common case when no server-side converter is
 * configured. The source bytes are always current when stored, so the viewer does not depend
 * on the derived-artifact pipeline.
 */
test("getAssetPreviewState renders a stored STEP source inline even without a derived artifact", () => {
  for (const availabilityStatus of ["downloaded", "validated"] as AssetAvailabilityStatus[]) {
    const state = getAssetPreviewState(
      stubAsset({
        availabilityStatus,
        fileFormat: "step",
        previewArtifactFormat: null,
        previewArtifactStorageKey: null,
        previewArtifactSource: null
      })
    );
    assert.equal(state.kind, "stored_step_source_inline", `expected source viewer for ${availabilityStatus}`);
  }
});

/**
 * Verifies the stored STEP source viewer is independent of the derived-artifact `previewStatus`.
 * previewStatus tracks the conversion pipeline, not the source bytes, so a pending or
 * not_available pipeline must not hide a STEP we already have on disk.
 */
test("getAssetPreviewState renders stored STEP source regardless of the derived-artifact previewStatus", () => {
  for (const previewStatus of ["pending", "not_available", "ready"] as PreviewStatus[]) {
    const state = getAssetPreviewState(
      stubAsset({
        availabilityStatus: "downloaded",
        fileFormat: "step",
        previewArtifactFormat: null,
        previewArtifactStorageKey: null,
        previewArtifactSource: null,
        previewStatus
      })
    );
    assert.equal(state.kind, "stored_step_source_inline", `expected source viewer for previewStatus ${previewStatus}`);
  }
});

/**
 * Verifies a reference-only STEP (no stored bytes) with no embeddable artifact surfaces the
 * explicit "preview pending artifact" branch — never the in-browser viewer (no bytes to read)
 * and never `ready_unsupported_format` (which would hide that conversion is the missing step).
 * Malformed artifact metadata must not route to the model-viewer either.
 */
test("getAssetPreviewState reports a reference-only STEP with no usable artifact as three_d_preview_pending_artifact", () => {
  const base: Partial<Asset> = { availabilityStatus: "referenced", fileFormat: "step" };

  const noArtifactKey = getAssetPreviewState(
    stubAsset({ ...base, previewArtifactFormat: null, previewArtifactStorageKey: null, previewArtifactSource: null })
  );
  assert.equal(noArtifactKey.kind, "three_d_preview_pending_artifact");

  const artifactKeyWithoutFormat = getAssetPreviewState(
    stubAsset({
      ...base,
      previewArtifactFormat: null,
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf"
    })
  );
  assert.equal(artifactKeyWithoutFormat.kind, "three_d_preview_pending_artifact");

  const formatButNoKey = getAssetPreviewState(
    stubAsset({
      ...base,
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
 * Verifies the *derived artifact* (model-viewer) path stays gated by `previewStatus`: a stored
 * STEP with a glb artifact recorded but `previewStatus = pending` must not use that artifact
 * (it could be stale while the worker iterates). It gracefully falls back to the in-browser
 * source viewer instead, and only promotes to the derived artifact once previewStatus is ready.
 */
test("getAssetPreviewState does not use a derived artifact until previewStatus is ready", () => {
  const pending = getAssetPreviewState(
    stubAsset({
      availabilityStatus: "downloaded",
      fileFormat: "step",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf",
      previewStatus: "pending"
    })
  );
  assert.equal(pending.kind, "stored_step_source_inline");

  const ready = getAssetPreviewState(
    stubAsset({
      availabilityStatus: "downloaded",
      fileFormat: "step",
      previewArtifactFormat: "glb",
      previewArtifactStorageKey: "cad/step/part-test/preview.glb",
      previewArtifactSource: "converter_step_to_gltf",
      previewStatus: "ready"
    })
  );
  assert.equal(ready.kind, "stored_three_d_inline");
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
