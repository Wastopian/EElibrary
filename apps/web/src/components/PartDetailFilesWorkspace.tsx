"use client";

/**
 * File header: Part detail file quick actions — open, download, 3D preview, and project uploads.
 */

import Link from "next/link";
import React, { useCallback, useState } from "react";
import { ENGINEERING_ASSET_TYPES } from "@ee-library/shared/asset-resolution";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { StatusBadge, type BadgeTone } from "@ee-library/ui";
import { canEmbedAssetPreview } from "./AssetInlinePreview";
import type { Asset, AssetClassSummary, AssetType, AssetValidationSummary, CatalogDataSource, ProjectPartKit, ProjectPartKitFileRef } from "@ee-library/shared/types";
import { buildAssetPreviewArtifactDownloadUrl, isApiClientError, uploadPartAsset, uploadProjectFile } from "../lib/api-client";
import { buildCatalogAssetFileActions, buildKitFileActions } from "../lib/part-kit-file-actions";
import {
  buildUploadedPartKitFileRef,
  MAX_PART_KIT_UPLOAD_BYTES,
  type PartKitUploadSlot,
  partKitSlotToCategory,
  readFileAsBase64,
  suggestPartKitFilename
} from "../lib/project-part-kit-upload";
import type { AssetClassReadiness } from "@ee-library/shared/types";

function formatAssetClassReadinessLabel(readiness: AssetClassReadiness): string {
  const labels: Record<AssetClassReadiness, string> = {
    downloaded_file: "Downloaded file on hand",
    export_ready: "Export-ready best asset",
    failed: "Failed asset state",
    missing: "No asset coverage",
    reference_only: "Reference-only record",
    validated_file: "Validated file on hand"
  };

  return labels[readiness];
}

interface PartDetailFilesWorkspaceProps {
  assetGroups: AssetClassSummary[];
  partId: string;
  partMpn: string;
  projectId?: string | undefined;
  projectKit?: ProjectPartKit | null;
  projectMirrorAvailable?: boolean | undefined;
  source: CatalogDataSource | undefined;
  supplierUrl: string | null;
  validationSummaries: AssetValidationSummary[];
}

/**
 * Renders the top-of-page files panel with open/download actions and optional project uploads.
 */
export function PartDetailFilesWorkspace({
  assetGroups,
  partId,
  partMpn,
  projectId,
  projectKit,
  projectMirrorAvailable,
  source,
  supplierUrl,
  validationSummaries
}: PartDetailFilesWorkspaceProps) {
  const groupsByType = new Map(assetGroups.map((group) => [group.assetType, group]));

  return (
    <div className="part-detail-files-workspace">
      {supplierUrl ? (
        <p className="part-detail-files-workspace__supplier">
          <a className="button-link" href={supplierUrl} rel="noreferrer" target="_blank">
            Open supplier page
          </a>
          <span className="muted-copy">Opens the purchase or product URL from your parts list or catalog source.</span>
        </p>
      ) : null}

      {projectKit?.note && projectId ? (
        <p className="part-detail-files-workspace__bom-note muted-copy">
          <strong>Parts list description:</strong> {projectKit.note}
        </p>
      ) : null}

      <ul className="part-files-list">
        {ENGINEERING_ASSET_TYPES.map((assetType) => {
          const group = groupsByType.get(assetType);

          return (
            <PartDetailFileRow
              assetType={assetType}
              group={group ?? null}
              key={assetType}
              partId={partId}
              partMpn={partMpn}
              projectId={projectId}
              projectKit={projectKit ?? null}
              projectMirrorAvailable={projectMirrorAvailable}
              source={source}
              validationSummaries={validationSummaries}
            />
          );
        })}
      </ul>

      {projectId && projectMirrorAvailable === true ? (
        <p className="part-detail-files-workspace__hint muted-copy">
          Uploads save to your project folder. Press <strong>Save</strong> on the project part kit to copy files into the catalog when the mirror is configured.
        </p>
      ) : null}
      {projectId && projectMirrorAvailable === false ? (
        <p className="part-detail-files-workspace__hint muted-copy">
          Project folder mirror is unavailable, so file uploads on this page save directly to the catalog as review-required manual assets.
        </p>
      ) : null}
    </div>
  );
}

interface PartDetailFileRowProps {
  assetType: AssetType;
  group: AssetClassSummary | null;
  partId: string;
  partMpn: string;
  projectId?: string | undefined;
  projectKit?: ProjectPartKit | null;
  projectMirrorAvailable?: boolean | undefined;
  source: CatalogDataSource | undefined;
  validationSummaries: AssetValidationSummary[];
}

function PartDetailFileRow({
  assetType,
  group,
  partId,
  partMpn,
  projectId,
  projectKit,
  projectMirrorAvailable,
  source,
  validationSummaries
}: PartDetailFileRowProps) {
  const label = assetTypeLabel(assetType);
  const uploadSlot = assetTypeToUploadSlot(assetType);
  const projectKitFile = uploadSlot && projectKit ? getProjectKitFile(projectKit, uploadSlot) : null;
  const [uploadedFile, setUploadedFile] = useState<ProjectPartKitFileRef | null>(null);
  const [uploadedCatalogAsset, setUploadedCatalogAsset] = useState<Asset | null>(null);
  const best = uploadedCatalogAsset ?? group?.bestAsset ?? null;
  const mirrorFile = uploadedFile ?? (projectKitFile?.source === "mirror" ? projectKitFile : null);
  const actions = best ? buildPartDetailFileActions(best, partId, source, assetType) : [];
  const projectActions = mirrorFile && projectId && uploadSlot ? buildKitFileActions(mirrorFile, partId, projectId, uploadSlot) : [];
  const validationSummary = best ? validationSummaries.find((entry) => entry.assetId === best.id) ?? null : null;
  const displayedFormat = best?.fileFormat ?? mirrorFile?.fileFormat ?? null;
  const uploadActionLabel = best || mirrorFile ? "Change file" : "Add file";
  const readinessLabel = best && !group ? "Downloaded file on hand" : group ? formatAssetClassReadinessLabel(group.readiness) : "No asset coverage";
  const readinessBadgeTone: BadgeTone = best && !group ? "review" : group ? readinessTone(group.readiness) : "neutral";

  return (
    <li className="part-files-list__row">
      <div className="part-files-list__identity">
        <strong>{label}</strong>
        {displayedFormat ? <span className="ui-mono part-files-list__format">{displayedFormat}</span> : null}
        {mirrorFile ? <span className="ui-mono part-files-list__project-file">{mirrorFile.name}</span> : null}
      </div>
      <StatusBadge
        label={readinessLabel}
        tone={readinessBadgeTone}
      />
      <span className="part-files-list__trust-check" title={validationSummary?.reason ?? undefined}>
        <StatusBadge
          label={validationSummary?.label ?? (best ? "On file" : mirrorFile ? "Project file" : "Missing")}
          tone={(validationSummary ? "info" : mirrorFile ? "review" : "neutral") as BadgeTone}
        />
      </span>
      <div className="part-files-list__actions">
        {actions.map((action) => (
          <a
            className="button-link button-link--quiet part-files-list__action"
            href={action.href}
            key={action.label}
            rel={action.external ? "noreferrer" : undefined}
            target={action.external ? "_blank" : undefined}
          >
            {action.label}
          </a>
        ))}
        {best && assetType === "three_d_model" && source !== "seed_fallback" && canEmbedAssetPreview(best) ? (
          <Link className="button-link button-link--quiet part-files-list__action" href="#part-asset-three_d_model">
            3D preview
          </Link>
        ) : null}
        {best && actions.length === 0 && source === "seed_fallback" ? (
          <span className="muted-copy part-files-list__action">Sample file not available</span>
        ) : null}
        {projectActions.map((action) => (
          <a
            className="button-link button-link--quiet part-files-list__action"
            href={action.href}
            key={`project-${action.label}`}
            rel="noreferrer"
            target="_blank"
          >
            {formatProjectFileActionLabel(action.label)}
          </a>
        ))}
        {projectId && uploadSlot && projectMirrorAvailable === true ? (
          <PartDetailFileUpload
            actionLabel={uploadActionLabel}
            onUploaded={setUploadedFile}
            projectId={projectId}
            slot={uploadSlot}
            suggestedMpn={partMpn}
          />
        ) : null}
        {uploadSlot && (!projectId || projectMirrorAvailable !== true) ? (
          <PartCatalogFileUpload
            actionLabel={uploadActionLabel}
            assetType={assetType}
            onUploaded={setUploadedCatalogAsset}
            partId={partId}
            suggestedMpn={partMpn}
          />
        ) : null}
      </div>
    </li>
  );
}

interface FileAction {
  external: boolean;
  href: string;
  label: string;
}

function buildPartDetailFileActions(asset: Asset, partId: string, source: CatalogDataSource | undefined, assetType: AssetType): FileAction[] {
  if (source === "seed_fallback") {
    // Seed fallback data has no real catalog store behind it, so database-backed download
    // links would 404. Offer the external source link when present, otherwise nothing.
    return asset.sourceUrl ? [{ external: true, href: asset.sourceUrl, label: "View source" }] : [];
  }

  if (isFileBackedAsset(asset)) {
    return buildCatalogAssetFileActions(asset, partId, assetType).map((action) => ({
      external: false,
      href: action.href,
      label: action.label
    }));
  }

  if (asset.availabilityStatus === "referenced" && asset.sourceUrl) {
    return [{ external: true, href: asset.sourceUrl, label: "View source" }];
  }

  if (assetType === "three_d_model" && hasEmbeddableThreeDPreview(asset)) {
    return [
      {
        external: false,
        href: buildAssetPreviewArtifactDownloadUrl(partId, asset.id),
        label: "Download preview"
      }
    ];
  }

  return [];
}

function hasEmbeddableThreeDPreview(asset: Asset): boolean {
  return Boolean(
    asset.previewArtifactStorageKey &&
      (asset.previewArtifactFormat === "glb" || asset.previewArtifactFormat === "gltf")
  );
}

/**
 * Maps asset classes to the upload slot used by project kit file APIs.
 */
function assetTypeToUploadSlot(assetType: AssetType): PartKitUploadSlot {
  if (assetType === "datasheet") {
    return "datasheet";
  }

  if (assetType === "three_d_model") {
    return "model";
  }

  if (assetType === "footprint") {
    return "footprint";
  }

  if (assetType === "symbol") {
    return "symbol";
  }

  return "mechanical_drawing";
}

/**
 * Picks the project mirror file for one upload slot.
 */
function getProjectKitFile(projectKit: ProjectPartKit, slot: PartKitUploadSlot): ProjectPartKitFileRef | null {
  if (slot === "datasheet") {
    return projectKit.datasheet;
  }

  if (slot === "model") {
    return projectKit.model;
  }

  if (slot === "footprint") {
    return projectKit.footprint;
  }

  if (slot === "symbol") {
    return projectKit.symbol;
  }

  return projectKit.mechanicalDrawing;
}

/**
 * Labels project-file actions distinctly from catalog-backed asset actions.
 */
function formatProjectFileActionLabel(label: string): string {
  if (label.startsWith("Open ")) {
    return label.replace(/^Open /u, "Open project ");
  }

  if (label.startsWith("Download ")) {
    return label.replace(/^Download /u, "Download project ");
  }

  return `Project ${label.toLowerCase()}`;
}

function readinessTone(readiness: AssetClassReadiness): BadgeTone {
  const tones: Record<AssetClassReadiness, BadgeTone> = {
    downloaded_file: "review",
    export_ready: "verified",
    failed: "danger",
    missing: "neutral",
    reference_only: "review",
    validated_file: "verified"
  };

  return tones[readiness];
}

function assetTypeLabel(assetType: AssetType): string {
  const labels: Record<AssetType, string> = {
    datasheet: "Datasheet",
    footprint: "Footprint",
    mechanical_drawing: "Mechanical drawing",
    symbol: "Symbol",
    three_d_model: "3D model"
  };

  return labels[assetType];
}

function PartDetailFileUpload({
  actionLabel,
  onUploaded,
  projectId,
  slot,
  suggestedMpn
}: {
  actionLabel: string;
  onUploaded: (fileRef: ProjectPartKitFileRef) => void;
  projectId: string;
  slot: PartKitUploadSlot;
  suggestedMpn: string;
}) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (file.size > MAX_PART_KIT_UPLOAD_BYTES) {
        setStatus("error");
        setMessage("File is too large.");
        return;
      }

      setStatus("uploading");
      setMessage(`Uploading ${file.name}…`);

      try {
        const result = await uploadProjectFile(projectId, partKitSlotToCategory(slot), {
          contentBase64: await readFileAsBase64(file),
          filename: suggestPartKitFilename(suggestedMpn, file)
        });
        onUploaded(buildUploadedPartKitFileRef(slot, result.entry.name));
        setStatus("done");
        setMessage(`Saved as ${result.entry.name}. Press Save on the project part kit to copy it into the catalog.`);
      } catch (error) {
        setStatus("error");
        setMessage(isApiClientError(error) ? error.message : "Upload failed.");
      }
    },
    [onUploaded, projectId, slot, suggestedMpn]
  );

  return (
    <label className={`file-upload${status === "uploading" ? " file-upload--disabled" : ""}`}>
      <input
        aria-label={`${actionLabel} for ${suggestedMpn}`}
        className="file-upload__input"
        disabled={status === "uploading"}
        onChange={(event) => void onChange(event)}
        type="file"
      />
      <span className="button-link button-link--quiet">{actionLabel}</span>
      {message ? <span className={`muted-copy${status === "error" ? " part-detail-files-workspace__upload--error" : ""}`}>{message}</span> : null}
    </label>
  );
}

/**
 * Renders the direct catalog upload control used when no project mirror can receive the file.
 */
function PartCatalogFileUpload({
  actionLabel,
  assetType,
  onUploaded,
  partId,
  suggestedMpn
}: {
  actionLabel: string;
  assetType: AssetType;
  onUploaded: (asset: Asset) => void;
  partId: string;
  suggestedMpn: string;
}) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (file.size > MAX_PART_KIT_UPLOAD_BYTES) {
        setStatus("error");
        setMessage("File is too large.");
        return;
      }

      setStatus("uploading");
      setMessage(`Uploading ${file.name}...`);

      try {
        const result = await uploadPartAsset(partId, assetType, {
          contentBase64: await readFileAsBase64(file),
          filename: suggestPartKitFilename(suggestedMpn, file)
        });
        onUploaded(result.asset);
        setStatus("done");
        setMessage("Saved to the catalog for engineering review.");
      } catch (error) {
        setStatus("error");
        setMessage(isApiClientError(error) ? error.message : "Upload failed.");
      }
    },
    [assetType, onUploaded, partId, suggestedMpn]
  );

  return (
    <label className={`file-upload${status === "uploading" ? " file-upload--disabled" : ""}`}>
      <input
        aria-label={`${actionLabel} ${assetTypeLabel(assetType)} for ${suggestedMpn}`}
        className="file-upload__input"
        disabled={status === "uploading"}
        onChange={(event) => void onChange(event)}
        type="file"
      />
      <span className="button-link button-link--quiet">{actionLabel}</span>
      {message ? <span className={`muted-copy${status === "error" ? " part-detail-files-workspace__upload--error" : ""}`}>{message}</span> : null}
    </label>
  );
}
