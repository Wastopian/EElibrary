/**
 * File header: Explicit client-side provider candidate lookup for DB-backed no-match states only.
 */

"use client";

import React, { useCallback, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { isApiClientError, requestProviderLookup } from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import { ImportByMpnPanel } from "./ImportByMpnPanel";
import type { ProviderLookupCandidate } from "@ee-library/shared/types";

/** ProviderLookupPanelProps carries the no-match lookup text and refresh target from the homepage. */
export interface ProviderLookupPanelProps {
  /** Concrete lookup text from the homepage quick-search field. */
  initialQuery: string;
  /** Search href used when a successful import should rerun the current catalog query. */
  refreshHref: string;
}

/** ProviderLookupPanelState keeps the explicit provider-lookup workflow honest and click-driven. */
type ProviderLookupPanelState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "candidates"; candidates: ProviderLookupCandidate[] }
  | { kind: "no_candidates" }
  | { kind: "failed"; message: string };

/**
 * Renders explicit exact-match provider lookup and reuses the shared import panel for candidate intake.
 */
export function ProviderLookupPanel({
  initialQuery,
  refreshHref
}: ProviderLookupPanelProps): React.ReactElement {
  const [status, setStatus] = useState<ProviderLookupPanelState>({ kind: "idle" });
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);

  /**
   * Runs explicit provider lookup only when the user asks for it from the no-match state.
   */
  const runLookup = useCallback(async () => {
    setStatus({ kind: "searching" });
    setSelectedCandidateKey(null);

    try {
      const candidates = await requestProviderLookup({ query: initialQuery });

      if (candidates.length === 0) {
        setStatus({ kind: "no_candidates" });
        return;
      }

      setStatus({ candidates, kind: "candidates" });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: isApiClientError(error)
          ? error.message.replace(/^Provider lookup failed \([^)]+?\):\s*/u, "")
          : importUiCopy.providerLookupFailure
      });
    }
  }, [initialQuery]);

  return (
    <div className="quick-provider-lookup">
      <p className="quick-provider-lookup__intro muted-copy">
        {importUiCopy.providerLookupLead} {importUiCopy.providerLookupExactNote} {importUiCopy.catalogAcquisitionNote}
      </p>

      <div className="quick-actions-row quick-actions-row--lookup">
        <button disabled={status.kind === "searching"} onClick={runLookup} type="button">
          {importUiCopy.buttonSearchProviders}
        </button>
      </div>

      {status.kind === "searching" ? (
        <p className="quick-check-empty__note">{importUiCopy.providerLookupSearching}</p>
      ) : null}

      {status.kind === "no_candidates" ? (
        <p className="quick-check-empty__note">{importUiCopy.providerLookupNoMatch}</p>
      ) : null}

      {status.kind === "failed" ? (
        <p className="quick-check-empty__note">
          <strong>{importUiCopy.providerLookupFailure}</strong> {status.message}
        </p>
      ) : null}

      {status.kind === "candidates" ? (
        <div className="quick-provider-candidates">
          {status.candidates.map((candidate) => {
            const candidateKey = buildCandidateKey(candidate);
            const isSelected = selectedCandidateKey === candidateKey;
            const importPanelProps = {
              autoRedirectOnSuccess: true,
              compact: true,
              initialManufacturerName: candidate.manufacturerName,
              initialMpn: candidate.mpn,
              initialProviderId: candidate.providerId,
              initialProviderPartId: candidate.providerPartKey,
              ...(candidate.sourceUrl ? { initialProviderUrl: candidate.sourceUrl } : {}),
              refreshHref
            };

            return (
              <section className="quick-provider-candidate" key={candidateKey}>
                <div className="quick-provider-candidate__summary">
                  <div className="quick-provider-candidate__identity">
                    <span className="ui-mono">{candidate.mpn}</span>
                    <span>
                      {candidate.manufacturerName} / {candidate.package}
                    </span>
                    <span className="quick-provider-candidate__source">
                      {candidate.providerId} / {candidate.providerPartKey}
                    </span>
                  </div>
                  <div className="quick-provider-candidate__badges">
                    <StatusBadge
                      label={candidate.matchType === "exact_mpn" ? "Exact MPN match" : "Exact provider id match"}
                      tone="verified"
                    />
                    <StatusBadge
                      label={candidate.importAllowed ? "Import available" : "Import unavailable"}
                      tone={candidate.importAllowed ? "info" : "review"}
                    />
                  </div>
                </div>

                {candidate.sourceUrl ? (
                  <p className="quick-provider-candidate__link">
                    <a href={candidate.sourceUrl} rel="noreferrer" target="_blank">
                      Open provider source
                    </a>
                  </p>
                ) : null}

                <div className="quick-provider-candidate__actions">
                  <button
                    disabled={!candidate.importAllowed}
                    onClick={() => setSelectedCandidateKey(isSelected ? null : candidateKey)}
                    type="button"
                  >
                    {importUiCopy.buttonImportCandidate}
                  </button>
                  {!candidate.importAllowed ? (
                    <p className="quick-check-empty__note">{importUiCopy.providerLookupImportUnavailable}</p>
                  ) : null}
                </div>

                {candidate.importAllowed && isSelected ? (
                  <ImportByMpnPanel {...importPanelProps} />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Builds a stable client-side key for one provider candidate row.
 */
function buildCandidateKey(candidate: ProviderLookupCandidate): string {
  return `${candidate.providerId}:${candidate.providerPartKey}`;
}
