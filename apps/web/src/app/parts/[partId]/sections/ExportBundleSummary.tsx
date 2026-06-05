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
      <section aria-label="Export bundle summary" className={`detail-export-summary detail-export-summary--${bundleReadiness.state}`}>
        <div className="detail-export-summary__lead">
          <div>
            <p className="app-kicker">Bundle gate</p>
            <h3 className="ui-mono">{bundleReadiness.label}</h3>
            <p>{bundleReadiness.reason}</p>
          </div>
          <div className="detail-export-summary__badges">
            <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
            <StatusBadge label={`${bundleReadiness.verifiedCadAssetCount} verified CAD`} tone={bundleReadiness.verifiedCadAssetCount > 0 ? "verified" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.fileBackedCadAssetCount} stored CAD file${bundleReadiness.fileBackedCadAssetCount === 1 ? "" : "s"}`} tone={bundleReadiness.fileBackedCadAssetCount > 0 ? "info" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.referencedAssetCount} URL-only references`} tone={bundleReadiness.referencedAssetCount > 0 ? "review" : "neutral"} />
          </div>
        </div>
        <div className="detail-export-summary__grid">
          <div>
            <span>Ready bundles</span>
            <strong>{availableBundleCount}</strong>
            <p>{availableBundleCount > 0 ? "These bundles have every required stored and verified file." : "No bundle has every required stored and verified file yet."}</p>
          </div>
          <div>
            <span>Blocked bundles</span>
            <strong>{blockedBundleCount}</strong>
            <p>{blockedBundleCount > 0 ? "These bundle targets still need missing review, validation, or promotion steps." : "Every supported bundle target is currently open."}</p>
          </div>
          <div>
            <span>Verified CAD</span>
            <strong>{bundleReadiness.verifiedCadAssetCount}</strong>
            <p>Verified CAD is the only asset class that can satisfy bundle export gates.</p>
          </div>
          <div>
            <span>Reference-only rows</span>
            <strong>{bundleReadiness.referencedAssetCount}</strong>
            <p>Referenced metadata stays visible for provenance, but it never unlocks export actions on its own.</p>
          </div>
        </div>
      </section>
      <div className="export-list">
        {bundleReadiness.exportActions.map((action) => (
          <button className={`export-action ${action.available ? "export-action--available" : "export-action--blocked"}`} disabled={!action.available} key={action.id} title={action.reason} type="button">
            <span className="export-action__eyebrow">{action.available ? "Export lane open" : "Export lane blocked"}</span>
            <strong>{action.label}</strong>
            <small>{action.reason}</small>
          </button>
        ))}
      </div>
    </>
  );
}
