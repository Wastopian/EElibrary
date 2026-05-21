"use client";

/**
 * File header: Part detail file quick actions — open, download, 3D preview, and project uploads.
 */

import Link from "next/link";
import React, { useCallback, useState } from "react";
import { ENGINEERING_ASSET_TYPES } from "@ee-library/shared/asset-resolution";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { StatusBadge, type BadgeTone } from "@ee-library/ui";
import type { Asset, AssetClassSummary, AssetType, AssetValidationSummary, CatalogDataSource, ProjectPartKit } from "@ee-library/shared/types";
import { buildAssetPreviewArtifactDownloadUrl, isApiClientError, uploadProjectFile } from "../lib/api-client";
import { buildCatalogAssetFileActions } from "../lib/part-kit-file-actions";
import {
  MAX_PART_KIT_UPLOAD_BYTES,
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
  projectId?: string;
  projectKit?: ProjectPartKit | null;
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
              source={source}
              validationSummaries={validationSummaries}
            />
          );
        })}
      </ul>

      {projectId ? (
        <p className="part-detail-files-workspace__hint muted-copy">
          Uploads save to your project folder. Press <strong>Save</strong> on the project part kit to copy files into the catalog when the mirror is configured.
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
  projectId?: string;
  source: CatalogDataSource | undefined;
  validationSummaries: AssetValidationSummary[];
}

function PartDetailFileRow({ assetType, group, partId, partMpn, projectId, source, validationSummaries }: PartDetailFileRowProps) {
  const best = group?.bestAsset ?? null;
  const label = assetTypeLabel(assetType);
  const uploadSlot = assetTypeToUploadSlot(assetType);
  const actions = best ? buildPartDetailFileActions(best, partId, source, assetType) : [];
  const previewAnchor = `#part-asset-${assetType}`;
  const validationSummary = best ? validationSummaries.find((entry) => entry.assetId === best.id) ?? null : null;

  return (
    <li className="part-files-list__row">
      <div className="part-files-list__identity">
        <strong>{label}</strong>
        {best?.fileFormat ? <span className="ui-mono part-files-list__format">{best.fileFormat}</span> : null}
      </div>
      <StatusBadge
        label={group ? formatAssetClassReadinessLabel(group.readiness) : "Not yet generated"}
        tone={group ? readinessTone(group.readiness) : "neutral"}
      />
      <span className="part-files-list__trust-check" title={validationSummary?.reason ?? undefined}>
        <StatusBadge label={validationSummary?.label ?? (best ? "On file" : "Missing")} tone={(validationSummary ? "info" : "neutral") as BadgeTone} />
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
        {best && (assetType === "three_d_model" || assetType === "datasheet") ? (
          <Link className="button-link button-link--quiet part-files-list__action" href={previewAnchor}>
            {assetType === "three_d_model" ? "3D preview" : "PDF preview"}
          </Link>
        ) : null}
        {!best && projectId && uploadSlot ? (
          <PartDetailFileUpload projectId={projectId} slot={uploadSlot} suggestedMpn={partMpn} />
        ) : null}
        {!best && !projectId ? <span className="muted-copy part-files-list__action">No file yet</span> : null}
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
  if (source === "seed_fallback" && asset.sourceUrl) {
    return [{ external: true, href: asset.sourceUrl, label: "View source" }];
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

function assetTypeToUploadSlot(assetType: AssetType): "datasheet" | "model" | "footprint" | null {
  if (assetType === "datasheet") {
    return "datasheet";
  }

  if (assetType === "three_d_model") {
    return "model";
  }

  if (assetType === "footprint") {
    return "footprint";
  }

  return null;
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
  projectId,
  slot,
  suggestedMpn
}: {
  projectId: string;
  slot: "datasheet" | "model" | "footprint";
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
        await uploadProjectFile(projectId, partKitSlotToCategory(slot), {
          contentBase64: await readFileAsBase64(file),
          filename: suggestPartKitFilename(suggestedMpn, file)
        });
        setStatus("done");
        setMessage(`Saved ${file.name} to the project folder. Refresh to see it in the catalog after kit sync.`);
      } catch (error) {
        setStatus("error");
        setMessage(isApiClientError(error) ? error.message : "Upload failed.");
      }
    },
    [projectId, slot, suggestedMpn]
  );

  return (
    <label className="part-detail-files-workspace__upload">
      <span className="button-link button-link--quiet">Add file</span>
      <input
        aria-label={`Upload ${slot} for ${suggestedMpn}`}
        className="part-detail-files-workspace__upload-input"
        disabled={status === "uploading"}
        onChange={(event) => void onChange(event)}
        type="file"
      />
      {message ? <span className={`muted-copy${status === "error" ? " part-detail-files-workspace__upload--error" : ""}`}>{message}</span> : null}
    </label>
  );
}
