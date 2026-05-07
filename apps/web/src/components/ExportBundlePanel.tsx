/**
 * File header: Client-side export bundle generation and history for project detail pages.
 */

"use client";

import React, { useCallback, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { buildExportBundleDownloadUrl, createExportBundle, isApiClientError } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { ExportBundle, ExportBundleAssemblyStatus, ExportBundleFormat, ExportBundleListResponse, ProjectRevision } from "@ee-library/shared/types";

/** ExportBundlePanelProps scopes bundle generation to one project. */
export interface ExportBundlePanelProps {
  bundles: ExportBundleListResponse;
  projectId: string;
  revisions: ProjectRevision[];
}

type BundleCreateState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "success"; bundle: ExportBundle }
  | { kind: "failed"; message: string };

const FORMAT_LABELS: Record<ExportBundleFormat, string> = {
  altium: "Altium (footprint + symbol)",
  neutral: "Neutral (all verified assets)",
  solidworks: "SolidWorks (3D model + mechanical drawing)"
};

/**
 * Renders export bundle generation controls and bundle history.
 */
export function ExportBundlePanel({ bundles, projectId, revisions }: ExportBundlePanelProps): React.ReactElement {
  const [createState, setCreateState] = useState<BundleCreateState>({ kind: "idle" });
  const [bundleList, setBundleList] = useState<ExportBundle[]>(bundles.bundles);
  const [format, setFormat] = useState<ExportBundleFormat>("neutral");
  const [revisionLabel, setRevisionLabel] = useState<string>("");

  const generateBundle = useCallback(async () => {
    setCreateState({ kind: "creating" });

    try {
      const result = await createExportBundle(projectId, {
        bundleFormat: format,
        revisionLabel: revisionLabel.trim() || null
      });

      setCreateState({ kind: "success", bundle: result.bundle });
      setBundleList((prev) => [result.bundle, ...prev]);
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Export bundle generation failed.";
      setCreateState({ kind: "failed", message });
    }
  }, [projectId, format, revisionLabel]);

  return (
    <div className="export-bundle-panel">
      <div className="export-bundle-panel__form">
        <h4 className="form-section-label">Generate export bundle</h4>
        <p className="form-hint">
          Bundles include only verified file-backed assets. Referenced-only or unverified assets are recorded as omissions in the manifest.
        </p>

        <div className="form-row">
          <label className="form-label" htmlFor="bundle-format">
            Format
          </label>
          <select
            className="form-select"
            id="bundle-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportBundleFormat)}
          >
            <option value="altium">{FORMAT_LABELS.altium}</option>
            <option value="solidworks">{FORMAT_LABELS.solidworks}</option>
            <option value="neutral">{FORMAT_LABELS.neutral}</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="bundle-revision">
            Revision (optional)
          </label>
          <select
            className="form-select"
            id="bundle-revision"
            value={revisionLabel}
            onChange={(e) => setRevisionLabel(e.target.value)}
          >
            <option value="">All revisions</option>
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.revisionLabel}>
                {rev.revisionLabel} ({rev.revisionStatus})
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={createState.kind === "creating"}
            type="button"
            onClick={generateBundle}
          >
            {createState.kind === "creating" ? "Generating…" : "Generate bundle"}
          </button>
        </div>

        {createState.kind === "success" && (
          <div className="form-feedback form-feedback--success">
            Bundle generated: {createState.bundle.includedAssetCount} assets included,{" "}
            {createState.bundle.omittedAssetCount} omitted.{" "}
            {createState.bundle.warningCount > 0 && `${createState.bundle.warningCount} warning(s).`}
          </div>
        )}

        {createState.kind === "failed" && (
          <div className="form-feedback form-feedback--error">{createState.message}</div>
        )}
      </div>

      <div className="export-bundle-panel__history">
        <h4 className="form-section-label">Bundle history</h4>
        {bundleList.length === 0 ? (
          <EmptyState
            title="No bundles yet"
            body="Generate a bundle above to create a manifest-first export package from this project's verified assets."
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Format</th>
                <th>Revision</th>
                <th>Parts</th>
                <th>Included</th>
                <th>Omitted</th>
                <th>Warnings</th>
                <th>Assembly</th>
                <th>Generated</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {bundleList.map((bundle) => (
                <BundleHistoryRow key={bundle.id} bundle={bundle} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BundleHistoryRow({ bundle }: { bundle: ExportBundle }): React.ReactElement {
  const [showManifest, setShowManifest] = useState(false);
  const manifestDownloadUrl = bundle.fileAvailability === "available" ? buildExportBundleDownloadUrl(bundle.storageKey) : null;
  const archiveDownloadUrl = bundle.archiveAvailability === "available" ? buildExportBundleDownloadUrl(bundle.archiveStorageKey) : null;
  const inlineWarnings = collectInlineBundleWarnings(bundle);

  return (
    <>
      <tr>
        <td>
          <StatusBadge label={bundle.bundleFormat} tone={formatTone(bundle.bundleFormat)} />
        </td>
        <td className="ui-mono">{bundle.revisionLabel ?? "All"}</td>
        <td>{bundle.partCount}</td>
        <td>{bundle.includedAssetCount}</td>
        <td>
          {bundle.omittedAssetCount > 0 ? (
            <span className="text-warning">{bundle.omittedAssetCount}</span>
          ) : (
            <span>{bundle.omittedAssetCount}</span>
          )}
        </td>
        <td>
          {bundle.warningCount > 0 ? (
            <span className="text-warning">{bundle.warningCount}</span>
          ) : (
            <span>{bundle.warningCount}</span>
          )}
        </td>
        <td>
          <BundleAssemblyCell bundle={bundle} />
        </td>
        <td className="ui-mono">{new Date(bundle.createdAt).toLocaleString()}</td>
        <td>
          <BundleAvailabilityCell bundle={bundle} archiveDownloadUrl={archiveDownloadUrl} manifestDownloadUrl={manifestDownloadUrl} />
        </td>
      </tr>
      {inlineWarnings.length > 0 && (
        <tr>
          <td colSpan={9}>
            <ul className="bundle-inline-warnings">
              {inlineWarnings.map((warning, i) => (
                <li key={i} className="form-feedback form-feedback--warning">
                  {warning}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
      {showManifest && (
        <tr>
          <td colSpan={9}>
            <BundleManifestDetail bundle={bundle} onClose={() => setShowManifest(false)} />
          </td>
        </tr>
      )}
      {!showManifest && (
        <tr>
          <td colSpan={9}>
            <button
              className="link-button"
              type="button"
              onClick={() => setShowManifest(true)}
            >
              View manifest ({bundle.manifest.includedAssets.length} included, {bundle.manifest.omissions.length} omitted)
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Renders the worker-side asset-byte assembly state for one bundle row.
 *
 * Assembly state is intentionally separate from `fileAvailability`: the manifest is persisted
 * synchronously by the API, while per-asset bytes are copied asynchronously by the worker.
 * Showing both keeps "manifest exists" honest from "asset bytes are ready for download".
 */
function BundleAssemblyCell({ bundle }: { bundle: ExportBundle }): React.ReactElement {
  if (bundle.assemblyStatus === "assembled") {
    return <StatusBadge label="Assembled" tone="verified" />;
  }

  if (bundle.assemblyStatus === "pending") {
    return <StatusBadge label="Assembling" tone="review" />;
  }

  if (bundle.assemblyStatus === "assembly_failed") {
    return <StatusBadge label="Assembly failed" tone="danger" />;
  }

  return <StatusBadge label="Not required" tone="info" />;
}

/**
 * Builds plain-language assembly-state telemetry suitable for the inline warning row.
 *
 * Returns null when there is nothing to surface (e.g. assembled or not_required) so the row stays
 * quiet during normal operation.
 */
export function buildBundleAssemblyTelemetryMessage(bundle: ExportBundle): string | null {
  if (bundle.assemblyStatus === "pending") {
    return `Worker is copying ${bundle.includedAssetCount} verified asset${bundle.includedAssetCount === 1 ? "" : "s"} into per-bundle storage.`;
  }

  if (bundle.assemblyStatus === "assembly_failed" && bundle.assemblyError) {
    const phaseCopy: Record<string, string> = {
      fetch_asset: "reading the source asset bytes",
      unknown: "an unclassified step",
      write_asset: "writing the per-bundle copy"
    };
    const phaseDescription = phaseCopy[bundle.assemblyError.phase] ?? "an unclassified step";
    const targetPath = bundle.assemblyError.failedBundlePath ?? bundle.assemblyError.failedAssetId ?? "an included asset";

    return `Bundle assembly failed at ${phaseDescription} for ${targetPath}: ${bundle.assemblyError.message}.`;
  }

  return null;
}

/**
 * Maps an assembly status to a stable label for non-DOM callers (printable summaries, tests).
 */
export function describeBundleAssemblyStatus(status: ExportBundleAssemblyStatus): string {
  switch (status) {
    case "assembled":
      return "Assembled";
    case "pending":
      return "Assembling";
    case "assembly_failed":
      return "Assembly failed";
    default:
      return "Not required";
  }
}

/**
 * Renders the availability cell for a bundle row.
 *
 * Two distinct artifacts can be downloaded once they exist:
 *   - the synchronous manifest archive (`storageKey`), recorded by the API at bundle creation, and
 *   - the worker-assembled `.tar.gz` (`archiveStorageKey`), produced after asset-byte assembly.
 * The archive download is preferred when present because it ships the verified asset bytes; the
 * manifest stays available as the audit-readable JSON record. Missing-file states surface honestly
 * so a broken link is never offered.
 */
function BundleAvailabilityCell({
  archiveDownloadUrl,
  bundle,
  manifestDownloadUrl
}: {
  archiveDownloadUrl: string | null;
  bundle: ExportBundle;
  manifestDownloadUrl: string | null;
}): React.ReactElement {
  return (
    <div className="bundle-download-cell">
      {bundle.archiveAvailability === "available" && archiveDownloadUrl ? (
        <a className="link-button" href={archiveDownloadUrl} download>
          Download archive (.tar.gz)
        </a>
      ) : bundle.archiveAvailability === "file_missing" ? (
        <span
          className="text-warning"
          title="Assembled archive is no longer present in storage. Regenerate the bundle to restore the archive."
        >
          Archive missing
        </span>
      ) : null}
      {bundle.fileAvailability === "available" && manifestDownloadUrl ? (
        <a className="link-button" href={manifestDownloadUrl} download>
          Download manifest
        </a>
      ) : bundle.fileAvailability === "file_missing" ? (
        <span
          className="text-warning"
          title="Manifest archive is no longer present in storage. Regenerate the bundle to restore the manifest."
        >
          Manifest missing
        </span>
      ) : null}
      {bundle.fileAvailability === "manifest_only" && bundle.archiveAvailability === "manifest_only" && (
        <span className="text-muted" title="Bundle has no captured storage file. Manifest still readable below.">
          Manifest only
        </span>
      )}
    </div>
  );
}

/**
 * Collects warnings worth surfacing on the bundle row itself, including referenced-only and missing omissions.
 */
function collectInlineBundleWarnings(bundle: ExportBundle): string[] {
  const messages: string[] = [...bundle.manifest.warnings];

  const referencedOnlyCount = bundle.manifest.omissions.filter((omission) => omission.reason === "referenced_only").length;
  const missingCount = bundle.manifest.omissions.filter((omission) => omission.reason === "missing").length;
  const unverifiedCount = bundle.manifest.omissions.filter((omission) => omission.reason === "not_verified_for_export").length;

  if (referencedOnlyCount > 0) {
    messages.push(`${referencedOnlyCount} referenced-only asset${referencedOnlyCount === 1 ? "" : "s"} excluded - file not captured locally.`);
  }
  if (missingCount > 0) {
    messages.push(`${missingCount} missing asset${missingCount === 1 ? "" : "s"} excluded - no source URL or storage key.`);
  }
  if (unverifiedCount > 0) {
    messages.push(`${unverifiedCount} unverified asset${unverifiedCount === 1 ? "" : "s"} excluded - awaiting verified-for-export promotion.`);
  }

  if (bundle.fileAvailability === "file_missing") {
    messages.push("Bundle file is no longer present in storage. Regenerate the bundle to restore the download link.");
  }

  const assemblyMessage = buildBundleAssemblyTelemetryMessage(bundle);
  if (assemblyMessage) {
    messages.push(assemblyMessage);
  }

  return messages;
}

function BundleManifestDetail({ bundle, onClose }: { bundle: ExportBundle; onClose: () => void }): React.ReactElement {
  return (
    <div className="bundle-manifest">
      <div className="bundle-manifest__header">
        <span className="ui-mono text-muted">Bundle {bundle.id}</span>
        <button className="link-button" type="button" onClick={onClose}>
          Hide manifest
        </button>
      </div>

      {bundle.manifest.warnings.length > 0 && (
        <div className="bundle-manifest__warnings">
          {bundle.manifest.warnings.map((warning, i) => (
            <div key={i} className="form-feedback form-feedback--warning">
              {warning}
            </div>
          ))}
        </div>
      )}

      {bundle.manifest.includedAssets.length > 0 && (
        <div className="bundle-manifest__section">
          <h5>Included assets ({bundle.manifest.includedAssets.length})</h5>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Part MPN</th>
                <th>Manufacturer</th>
                <th>Asset type</th>
                <th>Format</th>
                <th>Bundle path</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {bundle.manifest.includedAssets.map((asset) => (
                <tr key={asset.assetId}>
                  <td className="ui-mono">{asset.partMpn}</td>
                  <td>{asset.manufacturerName}</td>
                  <td>{asset.assetType}</td>
                  <td>{asset.fileFormat}</td>
                  <td className="ui-mono text-muted">{asset.bundlePath}</td>
                  <td className="ui-mono text-muted">{asset.fileHash ? asset.fileHash.slice(0, 12) + "…" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bundle.manifest.omissions.length > 0 && (
        <div className="bundle-manifest__section">
          <h5>Omissions ({bundle.manifest.omissions.length})</h5>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Part MPN</th>
                <th>Asset type</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {bundle.manifest.omissions.map((omission, i) => (
                <tr key={i}>
                  <td className="ui-mono">{omission.partMpn}</td>
                  <td>{omission.assetType}</td>
                  <td>
                    <StatusBadge label={omission.reason.replace(/_/g, " ")} tone="danger" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTone(format: ExportBundleFormat): BadgeTone {
  switch (format) {
    case "altium":
      return "info";
    case "solidworks":
      return "verified";
    default:
      return "review";
  }
}
