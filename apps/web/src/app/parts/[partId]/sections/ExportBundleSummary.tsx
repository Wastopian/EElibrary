/**
 * File header: Renders the export bundle gate as a compact workstation summary plus bundle actions.
 */

import { StatusBadge } from "@ee-library/ui";
import type { BundleReadinessSummary } from "@ee-library/shared/types";
import React from "react";
import { bundleReadinessTone } from "../lib/tone";

/**
 * Renders the export bundle gate as a compact workstation summary plus bundle actions.
 */
export function ExportBundleSummary({ bundleReadiness }: { bundleReadiness: BundleReadinessSummary }) {
  const availableBundleCount = bundleReadiness.exportActions.filter((action) => action.available).length;
  const blockedBundleCount = bundleReadiness.exportActions.length - availableBundleCount;

  return (
    <>
      <section aria-label="Export readiness" className={`detail-export-summary detail-export-summary--${bundleReadiness.state}`}>
        <div className="detail-export-summary__lead">
          <div>
            <p className="app-kicker">Export readiness</p>
            <h3 className="ui-mono">{bundleReadiness.label}</h3>
            <p>{bundleReadiness.reason}</p>
          </div>
          <div className="detail-export-summary__badges">
            <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
            <StatusBadge label={`${bundleReadiness.verifiedCadAssetCount} verified CAD`} tone={bundleReadiness.verifiedCadAssetCount > 0 ? "verified" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.fileBackedCadAssetCount} stored CAD file${bundleReadiness.fileBackedCadAssetCount === 1 ? "" : "s"}`} tone={bundleReadiness.fileBackedCadAssetCount > 0 ? "info" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.referencedAssetCount} link-only`} tone={bundleReadiness.referencedAssetCount > 0 ? "review" : "neutral"} />
          </div>
        </div>
        <div className="detail-export-summary__grid">
          <div>
            <span>Ready for export</span>
            <strong>{availableBundleCount}</strong>
            <p>{availableBundleCount > 0 ? "These export packages have every file we need." : "No export package has every file we need yet."}</p>
          </div>
          <div>
            <span>Not ready yet</span>
            <strong>{blockedBundleCount}</strong>
            <p>{blockedBundleCount > 0 ? "These packages still need a file checked or marked verified." : "Every supported package is ready or in progress."}</p>
          </div>
          <div>
            <span>Verified CAD files</span>
            <strong>{bundleReadiness.verifiedCadAssetCount}</strong>
            <p>Only files we've verified count toward an export-ready package.</p>
          </div>
          <div>
            <span>Link-only records</span>
            <strong>{bundleReadiness.referencedAssetCount}</strong>
            <p>Links to outside sources stay visible for traceability, but they cannot be downloaded as part of an export.</p>
          </div>
        </div>
      </section>
      <div className="export-list">
        {bundleReadiness.exportActions.map((action) => (
          <article className={`export-action ${action.available ? "export-action--available" : "export-action--blocked"}`} key={action.id} title={action.reason}>
            <span className="export-action__eyebrow">{action.available ? "Ready for project export" : "Not ready"}</span>
            <strong>{action.label}</strong>
            <small>{action.available ? `${action.reason} Build the downloadable package from a project that uses this part.` : action.reason}</small>
          </article>
        ))}
      </div>
    </>
  );
}
