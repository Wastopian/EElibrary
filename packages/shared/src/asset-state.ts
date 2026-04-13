/**
 * File header: Defines provider-neutral asset state helpers and export readiness rules.
 */

import type { Asset, AssetState } from "./types";

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
 * Checks whether an asset has captured storage plus hash evidence.
 */
export function isFileBackedAsset(asset: Pick<Asset, "fileHash" | "storageKey">): boolean {
  return asset.storageKey !== null && asset.fileHash !== null;
}

/**
 * Checks whether an asset can safely participate in export packaging.
 */
export function isValidatedDownloadableAsset(asset: Pick<Asset, "assetState" | "assetStatus" | "fileHash" | "storageKey" | "validationStatus">): boolean {
  return asset.assetState === "validated" && asset.assetStatus === "verified_for_export" && asset.storageKey !== null && asset.fileHash !== null && asset.validationStatus === "verified";
}

/**
 * Returns true when both storage and hash evidence exist for a downloaded file.
 */
function hasDownloadedFile(input: Pick<AssetStateInput, "fileHash" | "storageKey">): boolean {
  return input.storageKey !== null && input.fileHash !== null;
}
