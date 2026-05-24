/**
 * File header: Client-side export bundle generation and history for project detail pages.
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { buildExportBundleDownloadUrl, createExportBundle, emitProjectKicadLibrary, fetchProjectExportBundles, isApiClientError } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { ExportBundle, ExportBundleAssemblyStatus, ExportBundleFormat, ExportBundleListResponse, ExportBundleSignatureStatus, ExportBundleVerificationReason, ProjectRevision } from "@ee-library/shared/types";
import type { KicadLibraryEmissionSummary } from "@ee-library/shared/kicad-library-emission";

/**
 * BUNDLE_AUTO_REFRESH_INTERVAL_MS controls how often the panel re-fetches the bundle list while
 * one or more bundles are still in `pending` assembly. Slightly under the worker daemon's 30s
 * tick so a bundle that finishes assembly is reflected in the UI within one polling cycle of the
 * daemon completing rather than two. Idle panels (no pending bundles) do not poll at all.
 */
export const BUNDLE_AUTO_REFRESH_INTERVAL_MS = 8_000;

/**
 * Returns true when at least one bundle row is still in `pending` assembly and therefore the
 * panel should keep polling the API for updates. Pulled out of the component so the polling rule
 * can be exercised in unit tests without a DOM.
 *
 * `not_required` bundles never poll (no work to do); `assembled` and `assembly_failed` are
 * terminal states and also do not poll. Only `pending` rows trigger refreshes.
 */
export function shouldAutoRefreshBundleAssembly(bundles: readonly ExportBundle[]): boolean {
  return bundles.some((bundle) => bundle.assemblyStatus === "pending");
}

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

type KicadEmitState =
  | { kind: "idle" }
  | { kind: "emitting" }
  | { kind: "done"; summary: KicadLibraryEmissionSummary }
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
  const [kicadState, setKicadState] = useState<KicadEmitState>({ kind: "idle" });
  const [isAutoRefreshing, setIsAutoRefreshing] = useState<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);

  // Poll the bundle list while any bundle is still in `pending` assembly so the operator does not
  // have to manually reload to see the worker daemon's progress. The effect re-runs whenever the
  // bundle list changes; once every bundle has settled (assembled / assembly_failed / not_required)
  // the interval clears and the panel goes idle. A ref guards against overlapping fetches when a
  // request is slower than the polling interval.
  useEffect(() => {
    if (!shouldAutoRefreshBundleAssembly(bundleList)) {
      setIsAutoRefreshing(false);
      return;
    }

    setIsAutoRefreshing(true);

    const refreshBundleList = async () => {
      if (isFetchingRef.current) {
        return;
      }

      isFetchingRef.current = true;
      try {
        const refreshed = await fetchProjectExportBundles(projectId);
        setBundleList(refreshed.bundles);
      } catch {
        // Soft-fail: keep polling on the next interval. The next successful fetch will reconcile.
      } finally {
        isFetchingRef.current = false;
      }
    };

    const interval = setInterval(() => {
      void refreshBundleList();
    }, BUNDLE_AUTO_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [bundleList, projectId]);

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

  const emitKicadLibrary = useCallback(async () => {
    setKicadState({ kind: "emitting" });

    try {
      const summary = await emitProjectKicadLibrary(projectId, { revisionLabel: revisionLabel.trim() || undefined });
      setKicadState({ kind: "done", summary });
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "KiCad library emission failed.";
      setKicadState({ kind: "failed", message });
    }
  }, [projectId, revisionLabel]);

  const kicadDownloadUrl = kicadState.kind === "done" ? buildExportBundleDownloadUrl(kicadState.summary.storageKey) : null;

  return (
    <div className="export-bundle-panel">
      <div className="export-bundle-panel__form">
        <h4 className="form-section-label">Generate export bundle</h4>
        <p className="form-hint">
          Only verified files with stored content are included. Reference-only and unverified assets are listed as omissions in the manifest.
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

      <div className="export-bundle-panel__form">
        <h4 className="form-section-label">KiCad library</h4>
        <p className="form-hint">
          Packages this project's verified, file-backed KiCad assets into a drop-in library
          (merged symbols, a footprint <code>.pretty</code>, 3D models, and library tables). Only
          verified files are included; nothing is generated.
        </p>

        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={kicadState.kind === "emitting"}
            type="button"
            onClick={emitKicadLibrary}
          >
            {kicadState.kind === "emitting" ? "Building…" : "Build KiCad library"}
          </button>
        </div>

        {kicadState.kind === "done" && kicadState.summary.status === "emitted" && (
          <div className="form-feedback form-feedback--success">
            Library built: {kicadState.summary.includedPartCount} part(s) — {kicadState.summary.symbolCount} symbol(s),{" "}
            {kicadState.summary.footprintCount} footprint(s), {kicadState.summary.modelCount} 3D model(s).
            {kicadState.summary.omittedPartCount > 0 && ` ${kicadState.summary.omittedPartCount} part(s) omitted (no verified KiCad asset).`}
            {kicadDownloadUrl && (
              <>
                {" "}
                <a href={kicadDownloadUrl}>Download KiCad library (.tar.gz)</a>
              </>
            )}
          </div>
        )}

        {kicadState.kind === "done" && kicadState.summary.status === "empty" && (
          <div className="form-feedback">
            No verified file-backed KiCad assets in this project yet. Verify symbol/footprint/3D assets for export first.
          </div>
        )}

        {kicadState.kind === "failed" && (
          <div className="form-feedback form-feedback--error">{kicadState.message}</div>
        )}
      </div>

      <div className="export-bundle-panel__history">
        <div className="export-bundle-panel__history-header">
          <h4 className="form-section-label">Bundle history</h4>
          {isAutoRefreshing && (
            <span
              className="text-muted"
              role="status"
              aria-live="polite"
              title="Polling while one or more bundles are still being assembled by the worker."
            >
              Refreshing assembly status…
            </span>
          )}
        </div>
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
                <th>Controlled</th>
                <th>Warnings</th>
                <th>Assembly</th>
                <th>Signature</th>
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
          <BundleControlledCell bundle={bundle} />
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
        <td>
          <BundleSignatureCell bundle={bundle} />
        </td>
        <td className="ui-mono">{new Date(bundle.createdAt).toLocaleString()}</td>
        <td>
          <BundleAvailabilityCell bundle={bundle} archiveDownloadUrl={archiveDownloadUrl} manifestDownloadUrl={manifestDownloadUrl} />
        </td>
      </tr>
      {inlineWarnings.length > 0 && (
        <tr>
          <td colSpan={11}>
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
          <td colSpan={11}>
            <BundleManifestDetail bundle={bundle} onClose={() => setShowManifest(false)} />
          </td>
        </tr>
      )}
      {!showManifest && (
        <tr>
          <td colSpan={11}>
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
/**
 * Renders the controlled-asset summary cell for one bundle row. Shows nothing when
 * no included asset is bound to a restricted/itar_controlled revision; shows the
 * highest access level present plus the matching count when one exists.
 *
 * The cell stays compact so the table fits its existing column count on common widths;
 * the full per-asset list lives in the bundle manifest disclosure below the row.
 */
function BundleControlledCell({ bundle }: { bundle: ExportBundle }): React.ReactElement {
  const summary = bundle.manifest.controlSummary;
  if (!summary || summary.highestAccessLevel === null) {
    return <span className="text-muted">—</span>;
  }

  if (summary.highestAccessLevel === "itar_controlled") {
    return <StatusBadge label={`${summary.itarControlledCount} ITAR`} tone="danger" />;
  }

  return <StatusBadge label={`${summary.restrictedCount} restricted`} tone="review" />;
}

function BundleAssemblyCell({ bundle }: { bundle: ExportBundle }): React.ReactElement {
  return <StatusBadge label={describeBundleAssemblyStatus(bundle.assemblyStatus)} tone={assemblyStatusTone(bundle.assemblyStatus)} />;
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
 * Maps an assembly status to the matching badge tone without treating manifest creation as archive readiness.
 */
function assemblyStatusTone(status: ExportBundleAssemblyStatus): BadgeTone {
  switch (status) {
    case "assembled":
      return "verified";
    case "pending":
      return "review";
    case "assembly_failed":
      return "danger";
    default:
      return "info";
  }
}

/**
 * Maps cryptographic signature state to the label/tone shown in bundle history.
 */
export function describeSignatureStatus(status: ExportBundleSignatureStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case "signed":
      return { label: "Signed", tone: "verified" };
    case "verification_failed":
      return { label: "Verification failed", tone: "danger" };
    default:
      return { label: "Unsigned", tone: "info" };
  }
}

/**
 * Renders one bundle's signature and hash provenance without implying part approval.
 */
function BundleSignatureCell({ bundle }: { bundle: ExportBundle }): React.ReactElement {
  const status = describeSignatureStatus(bundle.signatureStatus);
  const fingerprint = bundle.signaturePublicKeyFingerprint ? shortHexHash(bundle.signaturePublicKeyFingerprint) : null;

  return (
    <div className="bundle-signature-cell">
      <StatusBadge label={status.label} tone={status.tone} />
      {fingerprint ? <span className="ui-mono text-muted">key {fingerprint}</span> : null}
      {bundle.archiveSha256 ? <span className="ui-mono text-muted">archive {shortHexHash(bundle.archiveSha256)}</span> : null}
    </div>
  );
}

/**
 * Maps a verification failure reason to operator-facing recovery copy.
 */
export function describeVerificationReason(reason: ExportBundleVerificationReason): string {
  switch (reason) {
    case "archive_missing":
      return "The assembled archive is missing from storage. Regenerate the bundle before using it.";
    case "archive_hash_mismatch":
      return "The archive bytes appear altered because the recomputed hash no longer matches the recorded hash.";
    case "signature_missing":
      return "The bundle was recorded as signed, but the detached signature file is missing. Regenerate or restore the signature.";
    case "signature_unreadable":
      return "The detached signature could not be read as a valid Ed25519 signature payload.";
    case "signature_algorithm_unsupported":
      return "The recorded signature algorithm is not supported by this deployment's verifier.";
    case "verification_key_unavailable":
      return "No verification key is configured. Set EE_LIBRARY_BUNDLE_VERIFICATION_KEY before relying on signed bundle verification.";
    case "verification_key_fingerprint_mismatch":
      return "The configured verification key does not match the signer key fingerprint recorded on this bundle.";
    case "signature_mismatch":
      return "The signature does not verify against the archive hash. Treat the bundle as altered and regenerate it.";
  }
}

/**
 * Shortens long hex identifiers while preserving enough leading and trailing context to compare rows.
 */
export function shortHexHash(hash: string): string {
  if (hash.length <= 16) {
    return hash;
  }

  return `${hash.slice(0, 8)}\u2026${hash.slice(-6)}`;
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
    messages.push(`${unverifiedCount} unverified asset${unverifiedCount === 1 ? "" : "s"} excluded - awaiting final verification.`);
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

      {(bundle.manifest.partProvenance ?? []).length > 0 && (
        <div className="bundle-manifest__section">
          <h5>Defensible provenance ({(bundle.manifest.partProvenance ?? []).length} parts)</h5>
          <p className="muted-copy">
            Captured at generation time and covered by the bundle signature, so an auditor or customer can verify it was not
            altered. This is a point-in-time record, not a re-derived trust gate.
          </p>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Part MPN</th>
                <th>Approved</th>
                <th>Datasheet revision</th>
                <th>Trusted assets</th>
                <th>Confirmed engineering memory</th>
              </tr>
            </thead>
            <tbody>
              {(bundle.manifest.partProvenance ?? []).map((entry) => (
                <tr key={entry.partId}>
                  <td className="ui-mono">{entry.partMpn}</td>
                  <td>
                    {entry.approval ? (
                      <>
                        <StatusBadge
                          label={entry.approval.status.replace(/_/g, " ")}
                          tone={entry.approval.status === "approved" ? "verified" : "review"}
                        />
                        {entry.approval.decidedBy ? (
                          <div className="muted-copy">
                            {entry.approval.decidedBy}
                            {entry.approval.decidedAt ? ` · ${new Date(entry.approval.decidedAt).toLocaleDateString()}` : ""}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted-copy">-</span>
                    )}
                  </td>
                  <td>
                    {entry.datasheetRevision ? (
                      <span>
                        {entry.datasheetRevision.revisionLabel ?? entry.datasheetRevision.datasheetRevisionId}
                        {entry.datasheetRevision.revisionDate ? ` (${new Date(entry.datasheetRevision.revisionDate).toLocaleDateString()})` : ""}
                      </span>
                    ) : (
                      <span className="muted-copy">-</span>
                    )}
                  </td>
                  <td>
                    {entry.trustedAssets.length > 0 ? (
                      <ul className="bundle-provenance__assets">
                        {entry.trustedAssets.map((asset) => (
                          <li key={asset.assetId}>
                            {asset.assetType} · {asset.provenance}
                            {asset.fileHash ? ` · sha256 ${asset.fileHash.slice(0, 12)}…` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted-copy">-</span>
                    )}
                  </td>
                  <td>
                    {entry.confirmedEngineeringMemory.length > 0 ? (
                      <ul className="bundle-provenance__memory">
                        {entry.confirmedEngineeringMemory.map((record) => (
                          <li key={record.recordId}>
                            <StatusBadge
                              label={record.severity === "blocking" ? "blocking" : record.outcome === "bit_us" ? "bit us" : record.recordKind.replace(/_/g, " ")}
                              tone={record.severity === "blocking" || record.outcome === "bit_us" ? "danger" : "info"}
                            />
                            <span>{record.title}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted-copy">none</span>
                    )}
                  </td>
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
