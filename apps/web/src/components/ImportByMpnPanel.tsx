/**
 * File header: Client-side operator import panel calling the API provider import route.
 */

"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, isApiClientError, requestProviderImport } from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import type { ProviderImportCreateInput } from "@ee-library/shared/types";
import type { ProviderImportCreateResponse } from "@ee-library/shared/types";

/** ImportByMpnPanelProps configures layout context for the shared import form. */
export interface ImportByMpnPanelProps {
  /** Optional anchor id for in-page navigation from quick links. */
  anchorId?: string;
  /** Optional MPN prefill for catalog acquisition from a no-match search state. */
  initialMpn?: string;
  /** Optional provider adapter prefill when importing a known provider candidate. */
  initialProviderId?: string;
  /** Optional provider part id prefill when a candidate was found by provider key. */
  initialProviderPartId?: string;
  /** Optional provider URL prefill retained as import context for a selected candidate. */
  initialProviderUrl?: string;
  /** Optional manufacturer hint prefill retained from a selected provider candidate. */
  initialManufacturerName?: string;
  /** Optional compact layout for the homepage no-match acquisition callout. */
  compact?: boolean;
  /** Optional redirect toggle after a successful import resolves a safe next route. */
  autoRedirectOnSuccess?: boolean;
  /** Optional href used to rerun the current search when no canonical part route target is available. */
  refreshHref?: string;
  /** Optional callback for client callers that need to observe a successful import result. */
  onSuccess?: (result: ProviderImportCreateResponse, action: ImportPanelSuccessAction) => void;
}

/** ImportPanelFailureState distinguishes actionable import failures from unavailable operations. */
export interface ImportPanelFailureState {
  kind: "failed" | "unavailable";
  message: string;
}

/** ImportPanelSuccessAction describes the safest post-import navigation the UI can take. */
export type ImportPanelSuccessAction =
  | { kind: "none" }
  | { kind: "open_part"; href: string }
  | { kind: "refresh_search"; href: string };

/** ImportPanelStatus keeps client-side import acquisition states explicit and testable. */
export type ImportPanelStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; action: ImportPanelSuccessAction }
  | { kind: "failed"; message: string }
  | { kind: "unavailable"; message: string };

/** ImportByMpnPanelStatusProps isolates status rendering so tests can cover failure copy without a browser harness. */
interface ImportByMpnPanelStatusProps {
  /** Explicit panel status from the shared import workflow. */
  status: ImportPanelStatus;
}

/**
 * Resolves a usable part detail route target without assuming the API payload is trustworthy.
 */
export function resolvePartDetailRouteTarget(partId: string | null | undefined): string | null {
  const normalizedPartId = typeof partId === "string" ? partId.trim() : "";

  return normalizedPartId.length > 0 ? `/parts/${encodeURIComponent(normalizedPartId)}` : null;
}

/**
 * Accepts only an internal part-detail route target when the API eventually returns one directly.
 */
export function resolveCanonicalImportRouteTarget(routeTarget: string | null | undefined): string | null {
  const normalizedRouteTarget = normalizeInternalHref(routeTarget);

  return normalizedRouteTarget?.startsWith("/parts/") ? normalizedRouteTarget : null;
}

/**
 * Chooses whether success should open a part detail page, refresh the current query, or stay put.
 */
export function resolveImportSuccessAction({
  canonicalRouteTarget,
  partId,
  refreshHref
}: {
  canonicalRouteTarget?: string | null;
  partId?: string | null;
  refreshHref?: string | null;
}): ImportPanelSuccessAction {
  const partRouteTarget = resolveCanonicalImportRouteTarget(canonicalRouteTarget) ?? resolvePartDetailRouteTarget(partId);

  if (partRouteTarget) {
    return { href: partRouteTarget, kind: "open_part" };
  }

  const normalizedRefreshHref = normalizeInternalHref(refreshHref);

  if (normalizedRefreshHref) {
    return { href: normalizedRefreshHref, kind: "refresh_search" };
  }

  return { kind: "none" };
}

/**
 * Maps API/client import failures into either a normal failure or an unavailable operation.
 */
export function resolveImportFailureState(error: unknown): ImportPanelFailureState {
  if (!isApiClientError(error)) {
    return {
      kind: "failed",
      message: importUiCopy.failureLead
    };
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return {
      kind: "unavailable",
      message: importUiCopy.catalogAcquisitionUnavailableSession
    };
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return {
      kind: "unavailable",
      message: importUiCopy.catalogAcquisitionUnavailableDatabase
    };
  }

  if (error.code === "UNKNOWN_PROVIDER") {
    return {
      kind: "unavailable",
      message: importUiCopy.catalogAcquisitionUnavailableProvider
    };
  }

  return {
    kind: "failed",
    message: stripApiClientFailurePrefix(error)
  };
}

/**
 * Renders MPN / provider id inputs with explicit pending, success, and failure states.
 */
export function ImportByMpnPanel({
  anchorId,
  autoRedirectOnSuccess = false,
  compact = false,
  initialManufacturerName,
  initialMpn,
  initialProviderId = "jlcparts",
  initialProviderPartId,
  initialProviderUrl,
  onSuccess,
  refreshHref
}: ImportByMpnPanelProps): React.ReactElement {
  const isCompact = compact;
  const [providerId, setProviderId] = useState(initialProviderId);
  const [mpn, setMpn] = useState(initialMpn ?? "");
  const [providerPartId, setProviderPartId] = useState(initialProviderPartId ?? "");
  const [providerUrl, setProviderUrl] = useState(initialProviderUrl ?? "");
  const [datasheetUrl, setDatasheetUrl] = useState("");
  const [manufacturerName, setManufacturerName] = useState(initialManufacturerName ?? "");
  const [status, setStatus] = useState<ImportPanelStatus>({ kind: "idle" });
  const refreshTimeoutRef = useRef<number | null>(null);
  const submitLabel = isCompact ? importUiCopy.buttonAcquireNoMatch : importUiCopy.buttonSubmit;

  /**
   * Cancels any pending post-success refresh so a stale no-match page cannot redirect after the context changes.
   */
  const clearScheduledRefresh = useCallback(() => {
    if (refreshTimeoutRef.current !== null) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  /**
   * Resynchronizes the no-match acquisition panel when a different lookup lands on the page.
   */
  useEffect(() => {
    clearScheduledRefresh();
    setProviderId(initialProviderId);
    setMpn(initialMpn ?? "");
    setProviderPartId(initialProviderPartId ?? "");
    setProviderUrl(initialProviderUrl ?? "");
    setDatasheetUrl("");
    setManufacturerName(initialManufacturerName ?? "");
    setStatus({ kind: "idle" });
  }, [clearScheduledRefresh, initialManufacturerName, initialMpn, initialProviderId, initialProviderPartId, initialProviderUrl, refreshHref]);

  /**
   * Clears the delayed refresh when the compact panel unmounts so no stale redirect survives navigation.
   */
  useEffect(() => clearScheduledRefresh, [clearScheduledRefresh]);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      clearScheduledRefresh();

      const trimmedMpn = mpn.trim();
      const trimmedPid = providerPartId.trim();
      const trimmedProviderUrl = providerUrl.trim();

      if (!trimmedMpn && !trimmedPid && !trimmedProviderUrl) {
        setStatus({ kind: "failed", message: importUiCopy.validationNeedLookup });
        return;
      }

      setStatus({ kind: "submitting" });

      const body: ProviderImportCreateInput = {
        datasheetUrl: datasheetUrl.trim() || null,
        manufacturerName: manufacturerName.trim() || null,
        mpn: trimmedMpn || null,
        providerId,
        providerPartId: trimmedPid || null,
        providerUrl: trimmedProviderUrl || null
      };

      try {
        const result = await requestProviderImport(body);
        const successAction = resolveImportSuccessAction({
          canonicalRouteTarget: readImportCanonicalRouteTarget(result),
          partId: result.partId,
          refreshHref: refreshHref ?? null
        });

        if (result.importStatus !== "imported") {
          setStatus({ kind: "failed", message: importUiCopy.failureLead });
          return;
        }

        setStatus({ action: successAction, kind: "success" });
        onSuccess?.(result, successAction);

        if (autoRedirectOnSuccess) {
          if (successAction.kind === "open_part") {
            navigateBrowserLocation(successAction.href);
          }

          if (successAction.kind === "refresh_search") {
            refreshTimeoutRef.current = scheduleBrowserRefresh(successAction.href);
          }
        }
      } catch (error: unknown) {
        setStatus(resolveImportFailureState(error));
      }
    },
    [autoRedirectOnSuccess, clearScheduledRefresh, datasheetUrl, manufacturerName, mpn, onSuccess, providerId, providerPartId, providerUrl, refreshHref]
  );

  const advancedLookupFields = (
    <>
      <label className="import-by-mpn-panel__field">
        <span>Provider part id (optional)</span>
        <input autoComplete="off" disabled={status.kind === "submitting"} onChange={(event) => setProviderPartId(event.target.value)} placeholder="e.g. LCSC C code when known" value={providerPartId} />
      </label>

      <label className="import-by-mpn-panel__field">
        <span>Provider URL (optional)</span>
        <input autoComplete="off" disabled={status.kind === "submitting"} onChange={(event) => setProviderUrl(event.target.value)} placeholder="Provider product URL when you have it" value={providerUrl} />
      </label>

      <label className="import-by-mpn-panel__field">
        <span>Datasheet URL (optional)</span>
        <input autoComplete="off" disabled={status.kind === "submitting"} onChange={(event) => setDatasheetUrl(event.target.value)} placeholder="Datasheet URL for traceability" value={datasheetUrl} />
      </label>

      <label className="import-by-mpn-panel__field">
        <span>Manufacturer hint (optional)</span>
        <input autoComplete="off" disabled={status.kind === "submitting"} onChange={(event) => setManufacturerName(event.target.value)} placeholder="Only when the provider needs disambiguation" value={manufacturerName} />
      </label>
    </>
  );

  return (
    <div className={`import-by-mpn-panel ${isCompact ? "import-by-mpn-panel--compact" : ""}`} id={anchorId}>
      <p className="import-by-mpn-panel__intro muted-copy">
        {isCompact
          ? `${importUiCopy.catalogAcquisitionLead} ${importUiCopy.catalogAcquisitionNote}`
          : "Import one exact part number from a configured supplier. This fetches supplier metadata; it does not verify CAD files or export bundles."}
      </p>

      <form className="import-by-mpn-panel__form" onSubmit={onSubmit}>
        <label className="import-by-mpn-panel__field">
          <span>Provider</span>
          <select disabled={status.kind === "submitting"} onChange={(event) => setProviderId(event.target.value)} value={providerId}>
            <option value="jlcparts">JLCPCB / LCSC (jlcparts) — free</option>
            <option value="digikey">DigiKey (digikey) — free API</option>
            <option value="mouser">Mouser (mouser) — free API</option>
            <option value="kicad">Local KiCad CAD index (kicad) — local</option>
            <option value="local-catalog">Local catalog (development)</option>
            <option value="octopart">Octopart / Nexar (octopart) — optional paid aggregator</option>
          </select>
        </label>

        <label className="import-by-mpn-panel__field">
          <span>MPN</span>
          <input autoComplete="off" disabled={status.kind === "submitting"} onChange={(event) => setMpn(event.target.value)} placeholder="e.g. RC-02W300JT" value={mpn} />
        </label>

        {isCompact ? (
          <details className="import-by-mpn-panel__details muted-copy">
            <summary>Add provider-specific lookup context</summary>
            <div className="import-by-mpn-panel__details-grid">{advancedLookupFields}</div>
          </details>
        ) : (
          advancedLookupFields
        )}

        <div className="import-by-mpn-panel__actions">
          <button disabled={status.kind === "submitting"} type="submit">
            {submitLabel}
          </button>
          {status.kind === "success" && status.action.kind === "open_part" ? (
            <Link className="button-link button-link--quiet" href={status.action.href}>
              {importUiCopy.linkOpenPart}
            </Link>
          ) : null}
          {status.kind === "success" && status.action.kind === "refresh_search" ? (
            <Link className="button-link button-link--quiet" href={status.action.href}>
              {importUiCopy.linkRefreshSearch}
            </Link>
          ) : null}
          {status.kind === "success" && status.action.kind === "open_part" && !isCompact ? (
            <Link className="button-link button-link--quiet" href="/admin">
              {importUiCopy.linkAdminImports}
            </Link>
          ) : null}
        </div>
      </form>

      <ImportByMpnPanelStatus status={status} />

      {!isCompact ? (
        <details className="import-by-mpn-panel__cli muted-copy">
          <summary>Advanced: worker CLI</summary>
          <pre className="import-by-mpn-panel__pre">{`npm run ingest -w @ee-library/worker -- jlcparts <MPN_OR_LCSC_ID>
npm run ingest -w @ee-library/worker -- octopart <MPN_OR_NEXAR_PART_ID>
npm run imports:providers`}</pre>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Renders the shared import status line so compact and full layouts stay in sync.
 */
export function ImportByMpnPanelStatus({ status }: ImportByMpnPanelStatusProps): React.ReactElement | null {
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "submitting") {
    return <p className="import-by-mpn-panel__status import-by-mpn-panel__status--pending">{importUiCopy.submitting}</p>;
  }

  if (status.kind === "success") {
    return (
      <p className="import-by-mpn-panel__status import-by-mpn-panel__status--success">
        {status.action.kind === "refresh_search" ? importUiCopy.successRefreshLead : importUiCopy.successLead}
      </p>
    );
  }

  if (status.kind === "failed") {
    return <p className="import-by-mpn-panel__status import-by-mpn-panel__status--failed">{status.message}</p>;
  }

  return <p className="import-by-mpn-panel__status import-by-mpn-panel__status--unavailable">{status.message}</p>;
}

/**
 * Removes the repetitive API error prefix so failure copy stays consistent with the rest of the UI.
 */
function stripApiClientFailurePrefix(error: ApiClientError): string {
  return error.message.replace(/^Provider import failed \([^)]+?\):\s*/u, "");
}

/**
 * Reads an optional canonical route target from the import response without widening the API contract.
 */
function readImportCanonicalRouteTarget(result: ProviderImportCreateResponse): string | null {
  const candidate = (result as ProviderImportCreateResponse & { canonicalRouteTarget?: string | null }).canonicalRouteTarget ?? null;

  return resolveCanonicalImportRouteTarget(candidate);
}

/**
 * Navigates to a browser location only when this client component is running in the browser.
 */
function navigateBrowserLocation(href: string): void {
  if (typeof window !== "undefined") {
    window.location.assign(href);
  }
}

/**
 * Reruns the current catalog search after a successful no-match acquisition when no part route target is available.
 */
function scheduleBrowserRefresh(href: string): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.setTimeout(() => {
    window.location.assign(href);
  }, 320) as number;
}

/**
 * Accepts only app-internal href values so the import panel never becomes an open redirect.
 */
function normalizeInternalHref(href: string | null | undefined): string | null {
  const normalizedHref = typeof href === "string" ? href.trim() : "";

  return normalizedHref.startsWith("/") ? normalizedHref : null;
}
