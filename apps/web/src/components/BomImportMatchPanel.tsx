/**
 * File header: Client-side BOM import matching action and result preview.
 */

"use client";

import Link from "next/link";
import React, { useCallback, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { isApiClientError, matchBomImportRows } from "../lib/api-client";
import type { BomImportMatchResponse, BomLineImportCandidate } from "@ee-library/shared/types";

/** BomImportMatchPanelProps identifies the import to match from the project detail table. */
export interface BomImportMatchPanelProps {
  /** Persisted BOM import id passed to the API match route. */
  bomImportId: string;
  /** Parent project id used to refresh the detail workspace after matching. */
  projectId: string;
}

/** BomImportMatchStatus tracks the client-side matching action state. */
type BomImportMatchStatus =
  | { kind: "idle" }
  | { kind: "matching" }
  | { kind: "success"; response: BomImportMatchResponse }
  | { kind: "failed"; message: string };

/**
 * Renders a scoped matching button and the most important post-match evidence.
 */
export function BomImportMatchPanel({ bomImportId, projectId }: BomImportMatchPanelProps): React.ReactElement {
  const [status, setStatus] = useState<BomImportMatchStatus>({ kind: "idle" });

  /**
   * Runs one deterministic matching pass through the API.
   */
  const onMatch = useCallback(async () => {
    setStatus({ kind: "matching" });

    try {
      const response = await matchBomImportRows(bomImportId);
      setStatus({ kind: "success", response });
      if (response.summary.usageCreatedOrUpdatedCount > 0) {
        refreshProjectDetail();
      }
    } catch (error) {
      setStatus({ kind: "failed", message: resolveBomMatchFailure(error) });
    }
  }, [bomImportId]);

  return (
    <div className="bom-match-panel">
      <button disabled={status.kind === "matching"} onClick={onMatch} type="button">
        {status.kind === "matching" ? "Matching..." : "Match rows"}
      </button>
      <BomMatchStatusMessage projectId={projectId} status={status} />
    </div>
  );
}

/**
 * Renders the current matching result or failure without hiding weak/ambiguous rows.
 */
function BomMatchStatusMessage({ projectId, status }: { projectId: string; status: BomImportMatchStatus }): React.ReactElement | null {
  if (status.kind === "idle") {
    return <p className="bom-match-panel__status muted-copy">Exact MPN plus manufacturer creates usage; weak and ambiguous rows stay line evidence.</p>;
  }

  if (status.kind === "matching") {
    return <p className="bom-match-panel__status muted-copy">Matching internal catalog rows...</p>;
  }

  if (status.kind === "failed") {
    return <p className="bom-match-panel__status bom-match-panel__status--failed">{status.message}</p>;
  }

  const { importCandidates, summary } = status.response;

  return (
    <div className="bom-match-panel__result">
      <div className="bom-match-panel__badges">
        <StatusBadge label={`${summary.matchedLineCount} matched`} tone={summary.matchedLineCount > 0 ? "verified" : "neutral"} />
        <StatusBadge label={`${summary.weakMatchLineCount} weak`} tone={summary.weakMatchLineCount > 0 ? "review" : "neutral"} />
        <StatusBadge label={`${summary.ambiguousLineCount} ambiguous`} tone={summary.ambiguousLineCount > 0 ? "review" : "neutral"} />
        <StatusBadge label={`${summary.unmatchedLineCount} unmatched`} tone={summary.unmatchedLineCount > 0 ? "danger" : "neutral"} />
      </div>
      <p className="bom-match-panel__status">
        {summary.usageCreatedOrUpdatedCount > 0 ? (
          <>
            {summary.usageCreatedOrUpdatedCount} usage row{summary.usageCreatedOrUpdatedCount === 1 ? "" : "s"} updated — confirmed usage and overlap refresh automatically.
            {" "}
            <Link href={`/projects/${encodeURIComponent(projectId)}#project-overlap-heading`}>Jump to overlap</Link>
            {" · "}
            <Link href={`/projects/${encodeURIComponent(projectId)}#project-usage-heading`}>Confirmed parts</Link>
          </>
        ) : (
          <>
            No new confirmed usage from this pass — weak or ambiguous rows stay unmatched until you fix source data or import missing parts.
            {" "}
            <Link href={`/projects/${encodeURIComponent(projectId)}`}>Reload project</Link>
          </>
        )}
      </p>
      {importCandidates.length > 0 ? <BomImportCandidateList candidates={importCandidates} /> : null}
    </div>
  );
}

/**
 * Renders unmatched exact-MPN rows as links into the existing catalog import path.
 */
function BomImportCandidateList({ candidates }: { candidates: BomLineImportCandidate[] }): React.ReactElement {
  return (
    <details className="bom-match-panel__candidates">
      <summary>{candidates.length} unmatched exact MPN rows can be imported</summary>
      <ul>
        {candidates.slice(0, 8).map((candidate) => (
          <li key={candidate.bomLineId}>
            <span>
              Row {candidate.rowNumber}: <span className="ui-mono">{candidate.mpn}</span>
              {candidate.manufacturerName ? ` / ${candidate.manufacturerName}` : ""}
            </span>
            <Link href={buildCatalogImportHref(candidate)}>Open exact import</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Builds the catalog no-match route that already owns exact provider import.
 */
function buildCatalogImportHref(candidate: BomLineImportCandidate): string {
  return `/catalog?q=${encodeURIComponent(candidate.mpn)}#quick-check`;
}

/**
 * Converts API failures into concise operator copy.
 */
function resolveBomMatchFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "BOM matching failed. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "BOM matching requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "BOM matching requires the project-memory database.";
  }

  return error.message.replace(/^BOM import match failed \([^)]+?\):\s*/u, "");
}

/**
 * Refreshes the current project workspace after a client-only matching action updates usage rows.
 */
function refreshProjectDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
