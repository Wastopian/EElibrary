/**
 * File header: Client-side operator import panel calling the API provider import route.
 */

"use client";

import Link from "next/link";
import React, { useCallback, useState } from "react";
import { isApiClientError, requestProviderImport } from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import type { ProviderImportCreateInput } from "@ee-library/shared/types";

/** ImportByMpnPanelProps configures layout context for the shared import form. */
export interface ImportByMpnPanelProps {
  /** Optional anchor id for in-page navigation from quick links. */
  anchorId?: string;
}

type PanelStatus = { kind: "idle" } | { kind: "submitting" } | { kind: "success"; partId: string } | { kind: "failed"; message: string };

/**
 * Renders MPN / provider id inputs with explicit pending, success, and failure states.
 */
export function ImportByMpnPanel({ anchorId }: ImportByMpnPanelProps): React.ReactElement {
  const [providerId, setProviderId] = useState("jlcparts");
  const [mpn, setMpn] = useState("");
  const [providerPartId, setProviderPartId] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [datasheetUrl, setDatasheetUrl] = useState("");
  const [manufacturerName, setManufacturerName] = useState("");
  const [status, setStatus] = useState<PanelStatus>({ kind: "idle" });

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

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

        if (result.importStatus !== "imported") {
          setStatus({ kind: "failed", message: importUiCopy.failureLead });
          return;
        }

        setStatus({ kind: "success", partId: result.partId });
      } catch (error: unknown) {
        if (isApiClientError(error)) {
          setStatus({ kind: "failed", message: error.message.replace(/^Provider import failed \([^)]+?\):\s*/u, "") });
          return;
        }

        setStatus({ kind: "failed", message: importUiCopy.failureLead });
      }
    },
    [datasheetUrl, manufacturerName, mpn, providerId, providerPartId, providerUrl]
  );

  return (
    <div className="import-by-mpn-panel" id={anchorId}>
      <p className="import-by-mpn-panel__intro muted-copy">
        Bring one part into your Postgres-backed catalog using the same import path as the worker CLI. This fetches provider metadata; it does not verify CAD files or export bundles.
      </p>

      <form className="import-by-mpn-panel__form" onSubmit={onSubmit}>
        <label className="import-by-mpn-panel__field">
          <span>Provider</span>
          <select disabled={status.kind === "submitting"} onChange={(event) => setProviderId(event.target.value)} value={providerId}>
            <option value="jlcparts">JLCPCB / LCSC (jlcparts)</option>
            <option value="local-catalog">Local catalog (development)</option>
          </select>
        </label>

        <label className="import-by-mpn-panel__field">
          <span>MPN</span>
          <input autoComplete="off" disabled={status.kind === "submitting"} onChange={(event) => setMpn(event.target.value)} placeholder="e.g. RC-02W300JT" value={mpn} />
        </label>

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

        <div className="import-by-mpn-panel__actions">
          <button disabled={status.kind === "submitting"} type="submit">
            {importUiCopy.buttonSubmit}
          </button>
          {status.kind === "success" ? (
            <Link className="button-link button-link--quiet" href={`/parts/${encodeURIComponent(status.partId)}`}>
              {importUiCopy.linkOpenPart}
            </Link>
          ) : null}
          {status.kind === "success" ? (
            <Link className="button-link button-link--quiet" href="/admin">
              {importUiCopy.linkAdminImports}
            </Link>
          ) : null}
        </div>
      </form>

      {status.kind === "submitting" ? <p className="import-by-mpn-panel__status import-by-mpn-panel__status--pending">{importUiCopy.submitting}</p> : null}
      {status.kind === "success" ? <p className="import-by-mpn-panel__status import-by-mpn-panel__status--success">{importUiCopy.successLead}</p> : null}
      {status.kind === "failed" ? <p className="import-by-mpn-panel__status import-by-mpn-panel__status--failed">{status.message}</p> : null}

      <details className="import-by-mpn-panel__cli muted-copy">
        <summary>Advanced: worker CLI</summary>
        <pre className="import-by-mpn-panel__pre">{`npm run ingest -w @ee-library/worker -- jlcparts <MPN_OR_LCSC_ID>
npm run imports:providers`}</pre>
      </details>
    </div>
  );
}
