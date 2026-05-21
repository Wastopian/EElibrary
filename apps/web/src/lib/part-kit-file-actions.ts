/**
 * File header: Open and download URLs for project part kit files and catalog assets.
 */

import type { Asset, ProjectPartKitFileRef } from "@ee-library/shared/types";
import { buildAssetDownloadUrl, buildAssetOpenUrl } from "./api-client";
import { buildProjectMirrorFileUrl } from "./project-part-kit-upload";

export type KitFileSlot = "datasheet" | "model" | "footprint";

export interface KitFileAction {
  href: string;
  label: string;
}

/**
 * Returns true when this kit file can open in the browser (PDF or image).
 */
export function isViewableKitFile(slot: KitFileSlot, fileRef: ProjectPartKitFileRef): boolean {
  if (isViewableAssetFormat(fileRef.fileFormat)) {
    return true;
  }

  if (slot === "datasheet") {
    return !hasNonPdfExtension(fileRef.name);
  }

  return isViewableFilename(fileRef.name);
}

/**
 * Builds open and download actions for one kit file row.
 */
export function buildKitFileActions(
  fileRef: ProjectPartKitFileRef,
  catalogPartId: string,
  projectId: string,
  slot: KitFileSlot
): KitFileAction[] {
  const urls = resolveKitFileUrls(fileRef, catalogPartId, projectId, slot);

  if (!urls.openHref && !urls.downloadHref) {
    return [];
  }

  const viewable = isViewableKitFile(slot, fileRef);
  const actions: KitFileAction[] = [];

  if (viewable && urls.openHref) {
    actions.push({
      href: urls.openHref,
      label: slot === "datasheet" ? "Open PDF" : "Open file"
    });
  }

  if (urls.downloadHref) {
    actions.push({
      href: urls.downloadHref,
      label: downloadLabelForSlot(slot)
    });
  }

  return actions;
}

/**
 * Builds open and download actions for one catalog asset on the part detail page.
 */
export function buildCatalogAssetFileActions(
  asset: Asset,
  partId: string,
  assetType: Asset["assetType"]
): KitFileAction[] {
  if (!isFileBackedAsset(asset)) {
    return [];
  }

  const viewable = isViewableAssetFormat(asset.fileFormat);
  const actions: KitFileAction[] = [];

  if (viewable) {
    actions.push({
      href: buildAssetOpenUrl(partId, asset.id),
      label: asset.fileFormat === "pdf" ? "Open PDF" : "Open file"
    });
  }

  actions.push({
    href: buildAssetDownloadUrl(partId, asset.id),
    label: downloadLabelForAssetType(assetType, asset.fileFormat)
  });

  return actions;
}

function resolveKitFileUrls(
  fileRef: ProjectPartKitFileRef,
  catalogPartId: string,
  projectId: string,
  slot: KitFileSlot
): { downloadHref: string | null; openHref: string | null } {
  if (fileRef.assetId) {
    const viewable = isViewableKitFile(slot, fileRef);

    return {
      downloadHref: buildAssetDownloadUrl(catalogPartId, fileRef.assetId),
      openHref: viewable ? buildAssetOpenUrl(catalogPartId, fileRef.assetId) : null
    };
  }

  if (fileRef.downloadUrl?.startsWith("/api/")) {
    const basePath = fileRef.downloadUrl.split("?")[0] ?? fileRef.downloadUrl;
    const viewable = isViewableKitFile(slot, fileRef);

    return {
      downloadHref: `${basePath}?attachment=1`,
      openHref: viewable ? basePath : null
    };
  }

  if (fileRef.downloadUrl) {
    return { downloadHref: fileRef.downloadUrl, openHref: fileRef.downloadUrl };
  }

  if (fileRef.relativePath) {
    const viewable = isViewableKitFile(slot, fileRef);

    return {
      downloadHref: buildProjectMirrorFileUrl(projectId, fileRef.relativePath, false),
      openHref: viewable ? buildProjectMirrorFileUrl(projectId, fileRef.relativePath, true) : null
    };
  }

  return { downloadHref: null, openHref: null };
}

function isViewableAssetFormat(format: ProjectPartKitFileRef["fileFormat"]): boolean {
  return format === "pdf" || format === "png" || format === "jpg" || format === "jpeg" || format === "webp";
}

function isViewableFilename(filename: string): boolean {
  const extension = fileExtension(filename);

  return extension === ".pdf" || extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".webp";
}

function hasNonPdfExtension(filename: string): boolean {
  const extension = fileExtension(filename);

  return extension === ".stp" || extension === ".step" || extension === ".kicad_mod" || extension === ".kicad_sym" || extension === ".dxf";
}

function fileExtension(filename: string): string {
  if (!filename.includes(".")) {
    return "";
  }

  return filename.slice(filename.lastIndexOf(".")).toLowerCase();
}

function downloadLabelForSlot(slot: KitFileSlot): string {
  if (slot === "model") {
    return "Download STEP";
  }

  if (slot === "datasheet") {
    return "Download PDF";
  }

  return "Download file";
}

function downloadLabelForAssetType(assetType: Asset["assetType"], fileFormat: Asset["fileFormat"]): string {
  if (assetType === "three_d_model" || fileFormat === "step") {
    return "Download STEP";
  }

  if (assetType === "datasheet" || fileFormat === "pdf") {
    return "Download PDF";
  }

  return "Download file";
}

function isFileBackedAsset(asset: Asset): boolean {
  return asset.availabilityStatus === "downloaded" || asset.availabilityStatus === "validated";
}
