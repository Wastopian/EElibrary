/**
 * In-browser preview for file-backed assets when the catalog marks preview as ready.
 *
 * Honesty rules:
 * - Only stored PDFs are embedded inline. STEP/KiCad/DXF assets stay download-only and we
 *   render an explicit "no inline preview" note so an engineer never wonders whether the
 *   missing iframe is a bug.
 * - When `previewStatus` is `pending`, we say so. When it is `not_available`, we render
 *   nothing (the surrounding AssetCard already shows a "No preview" badge — no need to
 *   double up).
 */

import React from "react";
import { buildAssetDownloadUrl } from "../lib/api-client";
import type { Asset, AssetAvailabilityStatus } from "@ee-library/shared/types";

/**
 * AssetPreviewState is the explicit, scannable outcome the inline preview component
 * renders for one asset. Each variant maps 1:1 to a piece of UI copy or an iframe.
 */
export type AssetPreviewState =
  | { kind: "stored_pdf_inline" }
  | { kind: "stored_image_inline" }
  | { kind: "pdf_reference_only" }
  | { kind: "image_reference_only" }
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

  if (asset.fileFormat === "pdf") {
    return { kind: "pdf_reference_only" };
  }

  if (isStoredImageFormat(asset.fileFormat)) {
    return { kind: "image_reference_only" };
  }

  return { kind: "ready_unsupported_format" };
}

/**
 * Returns true when an iframe preview is appropriate for this asset row.
 */
export function canEmbedAssetPreview(asset: Asset): boolean {
  const kind = getAssetPreviewState(asset).kind;
  return kind === "stored_pdf_inline" || kind === "stored_image_inline";
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
          <p className="asset-inline-preview__fallback muted-copy">
            If this frame stays blank, your browser or storage host may block embedding. Use <strong>Download</strong> instead—the file availability is unchanged.
          </p>
        </div>
      );
    }

    case "stored_image_inline": {
      const src = buildAssetDownloadUrl(partId, asset.id);

      return (
        <div className="asset-inline-preview">
          <p className="asset-inline-preview__caption">Inline preview (stored image)</p>
          <img alt={`${asset.assetType} preview`} className="asset-inline-preview__image" src={src} />
          <p className="asset-inline-preview__fallback muted-copy">
            If this image does not render, use <strong>Download</strong> to inspect the exact stored file.
          </p>
        </div>
      );
    }

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
