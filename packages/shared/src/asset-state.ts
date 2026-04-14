/**
 * File header: Defines provider-neutral asset state helpers and export readiness rules.
 */

import type { Asset, AssetAvailabilityStatus, AssetExportStatus, AssetReviewStatus, AssetState } from "./types";

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
 * Adds canonical docs-aligned truth fields to an asset that still uses legacy mirrors.
 */
export function withCanonicalAssetTruth<TAsset extends Omit<Asset, "availabilityStatus" | "exportStatus" | "reviewStatus">>(asset: TAsset): TAsset & Pick<Asset, "availabilityStatus" | "exportStatus" | "reviewStatus"> {
  return {
    ...asset,
    availabilityStatus: deriveAssetAvailabilityStatus(asset.assetState),
    exportStatus: deriveAssetExportStatus(asset),
    reviewStatus: deriveAssetReviewStatus(asset)
  };
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
