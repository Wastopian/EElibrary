/**
 * File header: Engineer-facing "Files and downloads" panel near the top of part detail.
 *
 * Each row exposes one asset class (Datasheet, Footprint, Symbol, 3D model) with the
 * best stored asset's availability, current trust check, and either a download or a
 * "view source" link. Stored bytes and reference URLs intentionally use different
 * action labels so a URL never looks like captured local bytes.
 */

import React from "react";
import { SectionPanel, StatusBadge } from "@ee-library/ui";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import type { Asset, AssetClassSummary, AssetValidationSummary, CatalogDataSource, ControlledDocumentRevision } from "@ee-library/shared/types";
import { buildAssetDownloadUrl } from "../../../../lib/api-client";
import {
  buildAssetTrustCheckSummary,
  buildMissingAssetTrustCheckSummary,
  findAssetValidationSummary,
  formatAssetClassReadinessLabel
} from "../lib/asset-helpers";
import { assetTypeLabel } from "../lib/format";
import { assetClassReadinessTone } from "../lib/tone";
import type { PartFilesRow } from "../lib/types";

/**
 * Renders the Files and downloads panel near the top of the part detail page so
 * cross-discipline engineers can find datasheets, footprints, symbols, and 3D
 * models without scrolling past the trust workflow.
 */
export function PartFilesPanel({
  assetGroups,
  gatedRevisionsByAssetId,
  partId,
  source,
  validationSummaries
}: {
  assetGroups: AssetClassSummary[];
  gatedRevisionsByAssetId: Map<string, ControlledDocumentRevision>;
  partId: string;
  source: CatalogDataSource | undefined;
  validationSummaries: AssetValidationSummary[];
}) {
  const assetRows: PartFilesRow[] = assetGroups.map((group) => {
    const best = group.bestAsset;
    if (!best) {
      return {
        action: null,
        format: undefined,
        label: assetTypeLabel(group.assetType),
        status: { label: "Not yet generated", tone: "neutral" },
        trustCheck: buildMissingAssetTrustCheckSummary(),
        unavailableLabel: "No file yet"
      };
    }

    const validationSummary = findAssetValidationSummary(validationSummaries, best);

    return {
      action: buildPartFileAction(best, partId, source, gatedRevisionsByAssetId.get(best.id) ?? null),
      format: best.fileFormat,
      label: assetTypeLabel(group.assetType),
      status: { label: formatAssetClassReadinessLabel(group.readiness), tone: assetClassReadinessTone(group.readiness) },
      trustCheck: buildAssetTrustCheckSummary(best, validationSummary),
      unavailableLabel: formatPartFileUnavailableLabel(best, source)
    };
  });

  return (
    <SectionPanel
      description="Datasheet PDF, 3D model, footprint, and symbol. If we have a stored file you can download it; if we only have a link, you can open the source. Only verified files can be used for export."
      title="Files and downloads"
    >
      <ul className="part-files-list">
        {assetRows.map((row) => (
          <li className="part-files-list__row" key={row.label}>
            <div className="part-files-list__identity">
              <strong>{row.label}</strong>
              {row.format ? <span className="ui-mono part-files-list__format">{row.format}</span> : null}
            </div>
            <StatusBadge label={row.status.label} tone={row.status.tone} />
            <span className="part-files-list__trust-check" title={row.trustCheck.detail}>
              <StatusBadge label={row.trustCheck.label} tone={row.trustCheck.tone} />
            </span>
            {row.action ? (
              <a className="button-link button-link--quiet part-files-list__action" href={row.action.href} rel="noopener noreferrer" target="_blank">
                {row.action.label}
              </a>
            ) : (
              <span className="muted-copy part-files-list__action">{row.unavailableLabel}</span>
            )}
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}

/**
 * Builds the top-panel action for one asset without collapsing references,
 * gated documents, or failed file rows into plain downloads.
 */
function buildPartFileAction(asset: Asset, partId: string, source: CatalogDataSource | undefined, gatedRevision: ControlledDocumentRevision | null): PartFilesRow["action"] {
  if (source === "seed_fallback") {
    return asset.sourceUrl ? { href: asset.sourceUrl, label: "View source" } : null;
  }

  if (asset.availabilityStatus === "failed") {
    return null;
  }

  if (isFileBackedAsset(asset)) {
    if (gatedRevision) {
      return {
        href: `${buildAssetDownloadUrl(partId, asset.id)}?ack=1`,
        label: "Acknowledge and download"
      };
    }

    return {
      href: buildAssetDownloadUrl(partId, asset.id),
      label: "Download file"
    };
  }

  if (asset.availabilityStatus === "referenced" && asset.sourceUrl) {
    return {
      href: asset.sourceUrl,
      label: "View source"
    };
  }

  return null;
}

/**
 * Explains why the top files panel is not offering an action for this asset row.
 */
function formatPartFileUnavailableLabel(asset: Asset, source: CatalogDataSource | undefined): string {
  if (source === "seed_fallback" && isFileBackedAsset(asset)) {
    return "Sample file not available";
  }

  if (asset.availabilityStatus === "failed") {
    return "File failed";
  }

  if (asset.availabilityStatus === "referenced") {
    return "No source URL";
  }

  if (asset.availabilityStatus === "downloaded" || asset.availabilityStatus === "validated") {
    return "Verification incomplete";
  }

  return "No file yet";
}
