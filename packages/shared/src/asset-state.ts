/**
 * File header: Defines provider-neutral asset state helpers and export readiness rules.
 */

import type { Asset, AssetAvailabilityStatus, AssetExportStatus, AssetPreviewArtifactFormat, AssetPreviewArtifactSource, AssetReviewStatus, AssetState, FileFormat } from "./types";

/** AssetStateInput contains the minimum evidence needed to derive an asset state. */
export interface AssetStateInput {
  /** Storage key when a captured file exists. */
  storageKey: string | null;
  /** File hash when a captured file was hashed. */
  fileHash: string | null;
  /** Provider source URL when only a reference exists. */
  sourceUrl: string | null;
  /** Validation status from metadata or file checks. */
  validationStatus: Asset["validationStatus"];
}

/**
 * Derives a concrete asset lifecycle state without pretending a referenced URL is downloaded.
 */
export function deriveAssetState(input: AssetStateInput): AssetState {
  if (input.validationStatus === "failed") {
    return "failed";
  }

  if (input.validationStatus === "verified" && hasDownloadedFile(input)) {
    return "validated";
  }

  if (hasDownloadedFile(input)) {
    return "downloaded";
  }

  if (input.sourceUrl) {
    return "referenced";
  }

  return "missing";
}

/**
 * Derives the canonical availability status from legacy file-state evidence.
 */
export function deriveAssetAvailabilityStatus(assetState: AssetState): AssetAvailabilityStatus {
  return assetState;
}

/**
 * Derives the canonical review status without turning export verification into review truth.
 */
export function deriveAssetReviewStatus(input: Pick<Asset, "assetStatus" | "provenance" | "validationStatus">): AssetReviewStatus {
  if (input.assetStatus === "failed" || input.validationStatus === "failed") {
    return "rejected";
  }

  if (input.assetStatus === "reviewed" || input.assetStatus === "verified_for_export") {
    return "approved";
  }

  if (input.provenance === "generated" || input.assetStatus === "downloaded" || input.assetStatus === "validated" || input.validationStatus === "needs_review") {
    return "review_required";
  }

  return "not_reviewed";
}

/**
 * Derives the canonical export status from verified file evidence and legacy export state.
 */
export function deriveAssetExportStatus(input: Pick<Asset, "assetState" | "assetStatus" | "fileHash" | "storageKey" | "validationStatus">): AssetExportStatus {
  if (input.assetState === "validated" && input.assetStatus === "verified_for_export" && isFileBackedAsset(input) && input.validationStatus === "verified") {
    return "verified_for_export";
  }

  if ((input.assetState === "downloaded" || input.assetState === "validated") && isFileBackedAsset(input) && input.validationStatus !== "failed") {
    return "partially_exportable";
  }

  return "not_exportable";
}

/**
 * AssetTruthInput is the subset of Asset fields a caller supplies to `withCanonicalAssetTruth`.
 *
 * Three derived truth fields (`availabilityStatus`, `exportStatus`, `reviewStatus`) are computed
 * by the helper. The four preview-artifact fields are **optional** so existing call sites that
 * pre-date the artifact channel keep compiling; missing values default to null inside the
 * helper, which is the correct "no derived rendering target recorded" state. Other Asset fields
 * stay required so the truth boundary cannot drift.
 *
 * Exported so seed fixtures and unit tests can `satisfies AssetTruthInput` without restating
 * the omitted fields per call site.
 */
export type AssetTruthInput = Omit<Asset, "availabilityStatus" | "exportStatus" | "reviewStatus" | "previewArtifactStorageKey" | "previewArtifactFormat" | "previewArtifactGeneratedAt" | "previewArtifactSource"> & {
  previewArtifactStorageKey?: string | null;
  previewArtifactFormat?: AssetPreviewArtifactFormat | null;
  previewArtifactGeneratedAt?: string | null;
  previewArtifactSource?: AssetPreviewArtifactSource | null;
};

/**
 * Adds canonical docs-aligned truth fields to an asset that still uses legacy mirrors.
 *
 * Also backfills the preview-artifact channel: if a caller provides no explicit artifact key but
 * the source `fileFormat` is itself directly embeddable (PDF / image / glb / gltf), the derived
 * artifact mirrors `storageKey` so the inline previewer can render the source bytes without a
 * separate conversion step. Non-embeddable source formats (STEP / kicad_mod / kicad_sym / dxf)
 * stay null so the previewer correctly falls back to "Preview generation queued" instead of
 * silently rendering nothing.
 */
export function withCanonicalAssetTruth<TAsset extends AssetTruthInput>(
  asset: TAsset
): TAsset & Pick<Asset, "availabilityStatus" | "exportStatus" | "reviewStatus" | "previewArtifactStorageKey" | "previewArtifactFormat" | "previewArtifactGeneratedAt" | "previewArtifactSource"> {
  const previewArtifactDefaults = derivePreviewArtifactDefaults(asset);
  return {
    ...asset,
    availabilityStatus: deriveAssetAvailabilityStatus(asset.assetState),
    exportStatus: deriveAssetExportStatus(asset),
    previewArtifactFormat: asset.previewArtifactFormat ?? previewArtifactDefaults.previewArtifactFormat,
    previewArtifactGeneratedAt: asset.previewArtifactGeneratedAt ?? null,
    previewArtifactSource: asset.previewArtifactSource ?? previewArtifactDefaults.previewArtifactSource,
    previewArtifactStorageKey: asset.previewArtifactStorageKey ?? previewArtifactDefaults.previewArtifactStorageKey,
    reviewStatus: deriveAssetReviewStatus(asset)
  };
}

/**
 * Derives the default preview-artifact fields from a source asset.
 *
 * The rule mirrors the inline-preview honesty matrix: if the source file is itself a format the
 * browser can render and the file is locally stored, the artifact channel reuses the source key
 * (`source_native`). Otherwise the channel stays empty so the worker conversion job has a clear
 * signal that derived bytes still need to be produced.
 */
function derivePreviewArtifactDefaults(asset: Pick<Asset, "fileFormat" | "storageKey" | "previewStatus" | "assetState">): {
  previewArtifactStorageKey: string | null;
  previewArtifactFormat: AssetPreviewArtifactFormat | null;
  previewArtifactSource: AssetPreviewArtifactSource | null;
} {
  if (!asset.storageKey) {
    return { previewArtifactFormat: null, previewArtifactSource: null, previewArtifactStorageKey: null };
  }

  if (asset.assetState !== "downloaded" && asset.assetState !== "validated") {
    return { previewArtifactFormat: null, previewArtifactSource: null, previewArtifactStorageKey: null };
  }

  const sourceNativeFormat = mapFileFormatToPreviewArtifactFormat(asset.fileFormat);
  if (sourceNativeFormat === null) {
    return { previewArtifactFormat: null, previewArtifactSource: null, previewArtifactStorageKey: null };
  }

  return {
    previewArtifactFormat: sourceNativeFormat,
    previewArtifactSource: "source_native",
    previewArtifactStorageKey: asset.storageKey
  };
}

/**
 * Maps a source file format to the matching preview-artifact format when the source is itself
 * directly embeddable. Returns null for source formats that need a converter step (STEP /
 * kicad_mod / kicad_sym / dxf / unknown) so the artifact channel stays empty until real bytes
 * exist.
 */
function mapFileFormatToPreviewArtifactFormat(fileFormat: FileFormat): AssetPreviewArtifactFormat | null {
  switch (fileFormat) {
    case "pdf":
      return "pdf";
    case "png":
      return "png";
    case "jpg":
      return "jpg";
    case "jpeg":
      return "jpeg";
    case "webp":
      return "webp";
    case "glb":
      return "glb";
    case "gltf":
      return "gltf";
    default:
      return null;
  }
}

/**
 * Checks whether an asset has captured storage plus hash evidence.
 */
export function isFileBackedAsset(asset: Pick<Asset, "fileHash" | "storageKey">): boolean {
  return asset.storageKey !== null && asset.fileHash !== null;
}

/**
 * Checks whether an asset can safely participate in export packaging.
 */
export function isValidatedDownloadableAsset(asset: Pick<Asset, "availabilityStatus" | "exportStatus" | "fileHash" | "storageKey" | "validationStatus">): boolean {
  return asset.availabilityStatus === "validated" && asset.exportStatus === "verified_for_export" && asset.storageKey !== null && asset.fileHash !== null && asset.validationStatus === "verified";
}

/**
 * Returns true when both storage and hash evidence exist for a downloaded file.
 */
function hasDownloadedFile(input: Pick<AssetStateInput, "fileHash" | "storageKey">): boolean {
  return input.storageKey !== null && input.fileHash !== null;
}
