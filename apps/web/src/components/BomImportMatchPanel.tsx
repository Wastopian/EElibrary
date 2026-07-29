/**
 * File header: Client-side BOM import matching action and result preview.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { isApiClientError, matchBomImportRows } from "../lib/api-client";
import { BomBackfillPanel } from "./BomBackfillPanel";
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
  const router = useRouter();
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
        router.refresh();
      }
    } catch (error) {
      setStatus({ kind: "failed", message: resolveBomMatchFailure(error) });
    }
  }, [bomImportId, router]);

  return (
    <div className="bom-match-panel">
      <button disabled={status.kind === "matching"} onClick={onMatch} type="button">
        {status.kind === "matching" ? "Matching..." : "Match rows"}
      </button>
      <BomMatchStatusMessage projectId={projectId} status={status} />
      <BomBackfillPanel
        bomImportId={bomImportId}
        unmatchedCandidateCount={status.kind === "success" ? status.response.importCandidates.length : 0}
      />
    </div>
  );
}

/**
 * Renders the current matching result or failure without hiding weak/ambiguous rows.
 */
function BomMatchStatusMessage({ projectId, status }: { projectId: string; status: BomImportMatchStatus }): React.ReactElement | null {
  if (status.kind === "idle") {
    return (
      <p className="bom-match-panel__status muted-copy">
        Click <strong>Match rows</strong> to link this upload to known parts. Rows that are not a clear match get flagged for review instead of linked, so nothing wrong is added by accident.
      </p>
    );
  }

  if (status.kind === "matching") {
    return <p className="bom-match-panel__status muted-copy">Looking for matches in the catalog...</p>;
  }

  if (status.kind === "failed") {
    return <p className="bom-match-panel__status bom-match-panel__status--failed">{status.message}</p>;
  }

  const { importCandidates, summary } = status.response;
  const reviewCount = summary.weakMatchLineCount + summary.ambiguousLineCount;
  const projectHref = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <div className="bom-match-panel__result">
      <div className="bom-match-panel__badges">
        <StatusBadge label={`${summary.matchedLineCount} matched`} tone={summary.matchedLineCount > 0 ? "verified" : "neutral"} />
        <StatusBadge label={`${summary.weakMatchLineCount} close match`} tone={summary.weakMatchLineCount > 0 ? "review" : "neutral"} />
        <StatusBadge label={`${summary.ambiguousLineCount} more than one match`} tone={summary.ambiguousLineCount > 0 ? "review" : "neutral"} />
        <StatusBadge label={`${summary.unmatchedLineCount} not found`} tone={summary.unmatchedLineCount > 0 ? "danger" : "neutral"} />
      </div>
      <p className="bom-match-panel__status">
        {summary.usageCreatedOrUpdatedCount > 0 ? (
          <>
            {summary.usageCreatedOrUpdatedCount} part{summary.usageCreatedOrUpdatedCount === 1 ? "" : "s"} linked to this project.
            {" "}
            <Link href={`${projectHref}#project-usage-heading`}>See linked parts</Link>
            {" · "}
            <Link href={`${projectHref}#project-overlap-heading`}>See overlap with other projects</Link>
          </>
        ) : (
          <>No new parts were linked from this pass.</>
        )}
      </p>
      {reviewCount > 0 ? (
        <p className="bom-match-panel__status">
          {reviewCount} row{reviewCount === 1 ? "" : "s"} need a closer look (close to a known part, or could match more than one).
          {" "}
          <Link href={`${projectHref}#project-bom-diagnostics-heading`}>Review in diagnostics</Link>
        </p>
      ) : null}
      {summary.unmatchedLineCount > 0 && importCandidates.length === 0 ? (
        <p className="bom-match-panel__status">
          {summary.unmatchedLineCount} row{summary.unmatchedLineCount === 1 ? "" : "s"} could not be matched. Check the MPN and manufacturer in your source file, or import the missing part from a supplier.
        </p>
      ) : null}
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
      <summary>{candidates.length} part{candidates.length === 1 ? "" : "s"} not in the catalog — import each from a supplier</summary>
      <ul>
        {candidates.slice(0, 8).map((candidate) => (
          <li key={candidate.bomLineId}>
            <span>
              Row {candidate.rowNumber}: <span className="ui-mono">{candidate.mpn}</span>
              {candidate.manufacturerName ? ` / ${candidate.manufacturerName}` : ""}
            </span>
            <Link href={buildCatalogImportHref(candidate)}>Import this part</Link>
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
