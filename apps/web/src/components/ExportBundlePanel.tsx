/**
 * File header: Client-side export bundle generation and history for project detail pages.
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { CopyableValue } from "./CopyableValue";
import {
  buildExportBundleDownloadUrl,
  createExportBundle,
  fetchProjectExportBundles,
  isApiClientError,
  verifyExportBundle
} from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  ExportBundle,
  ExportBundleAssemblyStatus,
  ExportBundleFormat,
  ExportBundleListResponse,
  ExportBundleSignatureStatus,
  ExportBundleVerificationReason,
  ExportBundleVerifyResponse,
  ProjectRevision
} from "@ee-library/shared/types";

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
  /**
   * When set, the generate button is rendered disabled and the reason is shown next to it. Used by
   * the parent to gate bundle creation when there is no confirmed usage or no verified file-backed
   * assets to include -- generating in that state would just produce an empty bundle.
   */
  disabledReason?: string | null;
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
export function ExportBundlePanel({ bundles, disabledReason, projectId, revisions }: ExportBundlePanelProps): React.ReactElement {
  const [createState, setCreateState] = useState<BundleCreateState>({ kind: "idle" });
  const [bundleList, setBundleList] = useState<ExportBundle[]>(bundles.bundles);
  const [format, setFormat] = useState<ExportBundleFormat>("neutral");
  const [revisionLabel, setRevisionLabel] = useState<string>("");
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
            disabled={createState.kind === "creating" || Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            type="button"
            onClick={generateBundle}
          >
            {createState.kind === "creating" ? "Generating…" : "Generate bundle"}
          </button>
          {disabledReason ? (
            <p className="form-feedback form-feedback--warning" role="status">{disabledReason}</p>
          ) : null}
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
          <>
            <p className="form-hint export-bundle-panel__legend muted-copy" role="note">
              Red = action needed (verification or assembly failed). Amber = review (assembling, controlled, omissions worth noting). Green = audit-grade outcome (signed + assembled). Grey = neutral / not applicable.
            </p>
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
                <th>Provenance</th>
                <th>Generated</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {bundleList.map((bundle) => (
                <BundleHistoryRow
                  key={bundle.id}
                  bundle={bundle}
                  onBundleUpdated={(updated) => {
                    setBundleList((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
                  }}
                />
              ))}
            </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function BundleHistoryRow({
  bundle,
  onBundleUpdated
}: {
  bundle: ExportBundle;
  onBundleUpdated: (updated: ExportBundle) => void;
}): React.ReactElement {
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
          <BundleProvenanceCell bundle={bundle} onBundleUpdated={onBundleUpdated} />
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
 * Stable copy for each `signatureStatus` so the badge label and tone are derived in one place.
 * The `tone` mirrors the file-availability discipline:
 *   - `unsigned`              → `info` (neutral; nothing claimed, nothing alarming)
 *   - `signed`                → `verified` (the only audit-grade outcome)
 *   - `verification_failed`   → `danger` (loud, with structured copy below)
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
 * Stable plain-language copy for each `verification_failed` reason so the row can recommend a
 * specific recovery action instead of a generic red badge. Keep the strings short -- the cell
 * is in a dense table.
 */
export function describeVerificationReason(reason: ExportBundleVerificationReason): string {
  switch (reason) {
    case "archive_missing":
      return "Archive bytes missing in storage. Regenerate the bundle.";
    case "archive_hash_mismatch":
      return "Archive bytes do not match the recorded hash. Bundle may have been altered.";
    case "signature_missing":
      return "Recorded signature file is no longer in storage.";
    case "signature_unreadable":
      return "Signature payload could not be parsed.";
    case "signature_algorithm_unsupported":
      return "Recorded algorithm is not supported by this verifier.";
    case "verification_key_unavailable":
      return "Configure EE_LIBRARY_BUNDLE_VERIFICATION_KEY on the API to verify.";
    case "verification_key_fingerprint_mismatch":
      return "Verification key does not match the signer recorded on this bundle.";
    case "signature_mismatch":
      return "Signature did not verify against the archive hash.";
    default:
      return "Verification failed.";
  }
}

/**
 * Truncates a hex hash for compact table display while keeping enough characters that two
 * different hashes are visually distinguishable. Full hash is still surfaced via the title
 * attribute so engineers can copy/paste it without expanding the row.
 */
export function shortHexHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

type BundleVerificationState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "completed"; outcome: ExportBundleVerifyResponse["outcome"] }
  | { kind: "failed"; message: string };

/**
 * Renders the cryptographic-provenance cell for one bundle row. Shows:
 *   - the signature-status badge,
 *   - a truncated archive SHA-256 (full hash on hover) when one is recorded,
 *   - the recorded signer fingerprint (truncated) when the bundle is signed,
 *   - a "Re-verify" button that calls the admin verify endpoint and updates the row's status.
 *
 * Honesty discipline:
 *   - When `verification_failed`, the structured `reason` (from the most recent verify call or
 *     from the persisted column) is rendered inline so the operator sees WHAT failed, not just
 *     THAT it failed.
 *   - When `unsigned`, no verification action is offered (there is nothing to verify).
 *   - Re-verify failures (network, auth) surface their own copy without overwriting the
 *     persisted status.
 */
function BundleProvenanceCell({
  bundle,
  onBundleUpdated
}: {
  bundle: ExportBundle;
  onBundleUpdated: (updated: ExportBundle) => void;
}): React.ReactElement {
  const [state, setState] = useState<BundleVerificationState>({ kind: "idle" });
  const { label, tone } = describeSignatureStatus(bundle.signatureStatus);

  const onReverify = useCallback(async () => {
    setState({ kind: "verifying" });
    try {
      const response = await verifyExportBundle(bundle.id);
      onBundleUpdated(response.bundle);
      setState({ kind: "completed", outcome: response.outcome });
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Verification request failed.";
      setState({ kind: "failed", message });
    }
  }, [bundle.id, onBundleUpdated]);

  const archiveSha256 = bundle.archiveSha256;
  // When the most recent verification outcome carries a recomputed hash that differs from the
  // recorded one, surface it side-by-side so the engineer can compare. We never overwrite the
  // recorded value -- it is the audit anchor.
  const recomputedSha256 =
    state.kind === "completed"
      && state.outcome.recomputedArchiveSha256
      && state.outcome.recomputedArchiveSha256 !== archiveSha256
      ? state.outcome.recomputedArchiveSha256
      : null;

  // Pull the structured reason from the most recent verify call when present so the cell can
  // explain WHY the bundle is currently `verification_failed`. When no verify call has happened
  // this session, fall back to a generic "see verify result" prompt -- the persisted column does
  // not store the reason, only the status.
  const failureReason =
    state.kind === "completed" && state.outcome.status === "verification_failed" && state.outcome.reason
      ? describeVerificationReason(state.outcome.reason)
      : null;

  return (
    <div className="bundle-provenance-cell">
      <StatusBadge label={label} tone={tone} />
      {archiveSha256 ? (
        <CopyableValue
          className="bundle-provenance-cell__hash"
          copyValue={archiveSha256}
          label={`Copy archive SHA-256 ${archiveSha256}`}
        >
          <span title={`Archive SHA-256: ${archiveSha256}`}>{shortHexHash(archiveSha256)}</span>
        </CopyableValue>
      ) : (
        <span className="text-muted">No hash recorded</span>
      )}
      {bundle.signatureStatus === "signed" && bundle.signaturePublicKeyFingerprint && (
        <CopyableValue
          className="bundle-provenance-cell__fingerprint"
          copyValue={bundle.signaturePublicKeyFingerprint}
          label={`Copy signer fingerprint ${bundle.signaturePublicKeyFingerprint}`}
        >
          <span title={`Signer fingerprint: ${bundle.signaturePublicKeyFingerprint}`}>
            Signer {shortHexHash(bundle.signaturePublicKeyFingerprint)}
          </span>
        </CopyableValue>
      )}
      {recomputedSha256 && (
        <span className="text-warning ui-mono" title={`Recomputed SHA-256: ${recomputedSha256}`}>
          Recomputed: {shortHexHash(recomputedSha256)}
        </span>
      )}
      {failureReason && <span className="text-warning bundle-provenance-cell__reason">{failureReason}</span>}
      {state.kind === "completed" && state.outcome.status === "signed" && state.outcome.verifiedAt && (
        <span className="text-muted">Verified {new Date(state.outcome.verifiedAt).toLocaleString()}</span>
      )}
      {state.kind === "failed" && <span className="text-warning">{state.message}</span>}
      {bundle.signatureStatus !== "unsigned" && bundle.archiveStorageKey && (
        <button
          className="link-button"
          type="button"
          disabled={state.kind === "verifying"}
          onClick={onReverify}
        >
          {state.kind === "verifying" ? "Verifying…" : "Re-verify"}
        </button>
      )}
    </div>
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
