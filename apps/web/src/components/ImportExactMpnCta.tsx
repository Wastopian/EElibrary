"use client";

/**
 * File header: Client-side CTA shown on the search page when an exact-MPN search returns no
 * matches. Calls POST /parts/import via api-client.importExactMpn and routes to /parts/:partId
 * on success. Generic queries never render this component because the search page gates it
 * with looksLikeExactMpn.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importExactMpn, type ImportExactMpnResult } from "../lib/api-client";

/** ImportExactMpnCtaProps describes the inputs the search page passes in. */
export interface ImportExactMpnCtaProps {
  /** Normalized MPN that triggered the import flow. */
  mpn: string;
  /** Optional provider id; when omitted the API uses its default registered adapter. */
  providerId?: string;
  /** Disables the CTA when the worker is offline AND the import path requires it (currently false because direct import is synchronous). */
  workerRequired?: boolean;
}

/**
 * Renders the Import exact MPN call to action with provider-specific failure copy.
 */
export function ImportExactMpnCta({ mpn, providerId, workerRequired = false }: ImportExactMpnCtaProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportExactMpnResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const disabled = submitting || isPending || workerRequired;

  async function handleClick() {
    setSubmitting(true);
    setResult(null);
    try {
      const response = await importExactMpn(mpn, providerId);
      setResult(response);

      if (response.status === "imported") {
        startTransition(() => {
          router.push(`/parts/${response.partId}`);
          router.refresh();
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="import-cta" data-testid="import-exact-mpn-cta">
      <div className="import-cta__copy">
        <h3>No catalog match for <span className="ui-mono">{mpn}</span></h3>
        <p>
          We can import this part directly from {providerId ?? "the default provider"} and route you to the detail page.
        </p>
      </div>
      <div className="import-cta__actions">
        <button disabled={disabled} onClick={handleClick} type="button">
          {submitting || isPending ? "Importing…" : `Import exact MPN`}
        </button>
        {workerRequired ? <small>Worker offline — import is unavailable until the worker daemon is running.</small> : null}
      </div>
      {result && result.status !== "imported" ? <ImportErrorMessage result={result} /> : null}
      {result && result.status === "imported" ? (
        <p className="import-cta__success">
          Imported {result.mpn}. Opening detail page…
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders a provider-specific failure or rejection message for the catalog UI.
 */
function ImportErrorMessage({ result }: { result: ImportExactMpnResult }) {
  if (result.status === "imported") {
    return null;
  }

  const { reason } = result;
  const headline =
    reason === "provider_part_not_found"
      ? `No supported provider had this MPN.`
      : reason === "provider_not_registered"
      ? `That provider is not registered.`
      : reason === "provider_fetch_failed"
      ? `The provider could not be reached.`
      : reason === "vague_query"
      ? `That query does not look like an exact MPN.`
      : reason === "network_error"
      ? `The web app could not reach the API service.`
      : `The import did not complete.`;

  return (
    <div className="import-cta__error" role="alert">
      <strong>{headline}</strong>
      <span>{result.message}</span>
    </div>
  );
}
