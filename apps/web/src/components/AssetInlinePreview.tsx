/**
 * In-browser preview for file-backed assets when the catalog marks preview as ready.
 *
 * Honesty rules:
 * - Only stored PDFs and stored images are embedded inline directly from the source bytes.
 *   For 3D models we render the *derived* preview artifact (glTF/glb), never the source
 *   STEP, and only when the worker has actually written that artifact and recorded an
 *   embeddable format alongside `previewStatus = ready`.
 * - STEP/KiCad/DXF assets without a derived preview stay download-only and we render an
 *   explicit "no inline preview" note so an engineer never wonders whether the missing
 *   slot is a bug.
 * - When `previewStatus` is `pending`, we say so. When it is `not_available`, we render
 *   nothing (the surrounding AssetCard already shows a "No preview" badge — no need to
 *   double up).
 * - Preview readiness never promotes the underlying asset: this component never mutates
 *   review/validation/export state.
 */

import React from "react";
import { buildAssetDownloadUrl, buildAssetPreviewArtifactDownloadUrl } from "../lib/api-client";
import type { Asset, AssetAvailabilityStatus, AssetPreviewArtifactFormat, FileFormat } from "@ee-library/shared/types";
import { ThreeDInlinePreview } from "./ThreeDInlinePreview";

/**
 * AssetPreviewState is the explicit, scannable outcome the inline preview component
 * renders for one asset. Each variant maps 1:1 to a piece of UI copy, an iframe, an
 * image tag, or the derived 3D viewer mount.
 */
export type AssetPreviewState =
  | { kind: "stored_pdf_inline" }
  | { kind: "stored_image_inline" }
  | { kind: "stored_three_d_inline"; previewArtifactFormat: AssetPreviewArtifactFormat }
  | { kind: "pdf_reference_only" }
  | { kind: "image_reference_only" }
  | { kind: "three_d_preview_pending_artifact" }
  | { kind: "ready_unsupported_format" }
  | { kind: "preview_pending" }
  | { kind: "preview_not_available" };

/**
 * Maps an asset record to the preview state the UI should render.
 *
 * Exported so we can test the matrix without rendering React.
 */
export function getAssetPreviewState(asset: Asset): AssetPreviewState {
  if (asset.previewStatus === "pending") {
    return { kind: "preview_pending" };
  }

  if (asset.previewStatus !== "ready") {
    return { kind: "preview_not_available" };
  }

  if (isStoredImageFormat(asset.fileFormat) && isStoredFileAvailability(asset.availabilityStatus)) {
    return { kind: "stored_image_inline" };
  }

  if (asset.fileFormat === "pdf" && isStoredFileAvailability(asset.availabilityStatus)) {
    return { kind: "stored_pdf_inline" };
  }

  if (isThreeDSourceFormat(asset.fileFormat)) {
    if (
      isEmbeddableThreeDPreviewArtifactFormat(asset.previewArtifactFormat) &&
      typeof asset.previewArtifactStorageKey === "string" &&
      asset.previewArtifactStorageKey.length > 0
    ) {
      return { kind: "stored_three_d_inline", previewArtifactFormat: asset.previewArtifactFormat };
    }

    return { kind: "three_d_preview_pending_artifact" };
  }

  if (asset.fileFormat === "pdf") {
    return { kind: "pdf_reference_only" };
  }

  if (isStoredImageFormat(asset.fileFormat)) {
    return { kind: "image_reference_only" };
  }

  return { kind: "ready_unsupported_format" };
}

/**
 * Returns true when an inline embedded preview is appropriate for this asset row.
 *
 * "Embed" here means we render bytes (or a derived viewer artifact) directly inside
 * the page rather than linking out — i.e. PDFs, images, and 3D models with a stored
 * derived artifact.
 */
export function canEmbedAssetPreview(asset: Asset): boolean {
  const kind = getAssetPreviewState(asset).kind;
  return kind === "stored_pdf_inline" || kind === "stored_image_inline" || kind === "stored_three_d_inline";
}

/**
 * Returns true when the asset points at bytes captured in local storage.
 */
function isStoredFileAvailability(status: AssetAvailabilityStatus): boolean {
  return status === "downloaded" || status === "validated";
}

/**
 * Returns true for browser-embeddable bitmap previews.
 */
function isStoredImageFormat(format: Asset["fileFormat"]): boolean {
  return format === "png" || format === "jpg" || format === "jpeg" || format === "webp";
}

/**
 * Returns true for 3D source formats that need a derived viewer artifact to render inline.
 *
 * STEP is the canonical case; the worker converts it to glb/gltf and records the artifact
 * pointer separately so the source bytes' availability/trust contract is never confused
 * with the derived viewer artifact.
 */
function isThreeDSourceFormat(format: FileFormat): boolean {
  return format === "step" || format === "glb" || format === "gltf";
}

/**
 * Returns true when the preview artifact format is something a browser viewer can render
 * inline (currently glb and gltf). Defends against drift between the DB CHECK constraint
 * and the UI: only known-renderable formats produce the inline 3D state.
 */
function isEmbeddableThreeDPreviewArtifactFormat(
  format: Asset["previewArtifactFormat"]
): format is AssetPreviewArtifactFormat {
  return format === "glb" || format === "gltf";
}

type AssetInlinePreviewProps = {
  asset: Asset;
  partId: string;
};

/**
 * Renders an inline preview for stored PDF assets and explicit non-preview copy for
 * everything else, so engineers never see a silently empty preview slot.
 */
export function AssetInlinePreview({ asset, partId }: AssetInlinePreviewProps) {
  const state = getAssetPreviewState(asset);

  switch (state.kind) {
    case "stored_pdf_inline": {
      const src = buildAssetDownloadUrl(partId, asset.id);

      return (
        <div className="asset-inline-preview">
          <p className="asset-inline-preview__caption">Inline preview (stored PDF)</p>
          <iframe className="asset-inline-preview__frame" src={src} title={`PDF preview for ${asset.assetType}`} />
          <details className="asset-inline-preview__fallback-details">
            <summary>Frame blank?</summary>
            <p className="muted-copy">
              If this frame stays blank, your browser or storage host may block embedding. Use <strong>Download</strong> instead—the file availability is unchanged.
            </p>
          </details>
        </div>
      );
    }

    case "stored_image_inline": {
      const src = buildAssetDownloadUrl(partId, asset.id);

      return (
        <div className="asset-inline-preview">
          <p className="asset-inline-preview__caption">Inline preview (stored image)</p>
          <img alt={`${asset.assetType} preview`} className="asset-inline-preview__image" src={src} />
          <details className="asset-inline-preview__fallback-details">
            <summary>Image not rendering?</summary>
            <p className="muted-copy">
              If this image does not render, use <strong>Download</strong> to inspect the exact stored file.
            </p>
          </details>
        </div>
      );
    }

    case "stored_three_d_inline": {
      const artifactUrl = buildAssetPreviewArtifactDownloadUrl(partId, asset.id);

      return (
        <ThreeDInlinePreview
          altText={`3D preview for ${asset.assetType}`}
          artifactUrl={artifactUrl}
        />
      );
    }

    case "three_d_preview_pending_artifact":
      return (
        <div className="asset-inline-preview asset-inline-preview--note" role="status">
          <p className="muted-copy">
            Preview is marked ready, but no derived viewer artifact (glTF/glb) has been written yet. Use <strong>Download</strong> to inspect the source 3D file in your CAD tool.
          </p>
        </div>
      );

    case "pdf_reference_only":
      return (
        <div className="asset-inline-preview asset-inline-preview--note" role="note">
          <p className="muted-copy">
            Preview is marked ready, but the file is reference-only or not in local storage. Open <strong>View source</strong> or <strong>Download</strong> to inspect the PDF in a new tab.
          </p>
        </div>
      );

    case "image_reference_only":
      return (
        <div className="asset-inline-preview asset-inline-preview--note" role="note">
          <p className="muted-copy">
            Preview is marked ready, but the image file is reference-only or not captured in local storage. Use <strong>View source</strong> or <strong>Download</strong> to inspect it.
          </p>
        </div>
      );

    case "ready_unsupported_format":
      return (
        <div className="asset-inline-preview asset-inline-preview--note" role="note">
          <p className="muted-copy">
            Preview is marked ready in metadata, but inline rendering supports only stored PDFs today. Use <strong>Download</strong> and open the file in the matching CAD tool.
          </p>
        </div>
      );

    case "preview_pending":
      return (
        <div className="asset-inline-preview asset-inline-preview--note" role="status">
          <p className="muted-copy">
            Preview generation is queued. The <strong>Download</strong> and <strong>View source</strong> links still work; check back later for the inline preview.
          </p>
        </div>
      );

    case "preview_not_available":
      return null;
  }
}
