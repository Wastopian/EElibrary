/**
 * File header: Batch missing-part import progress panel for one matched BOM import.
 *
 * One action queues every part the match pass could not find, the worker imports them in the
 * background, and this panel polls progress into plain buckets: imported, needs your pick, not
 * found, and failed. Rows needing a pick link into the existing one-at-a-time catalog import flow.
 * Batch-imported parts arrive exactly as unreviewed imports — never approved, validated, or
 * export-ready — and the panel repeats that boundary.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { fetchBomBackfillStatus, isApiClientError, startBomBackfill } from "../lib/api-client";
import type { BomBackfillRequestRecord, BomBackfillStatusResponse } from "@ee-library/shared/types";

/** POLL_INTERVAL_MS paces the progress poll while imports are still running. */
const POLL_INTERVAL_MS = 5_000;

/** BomBackfillPanelProps scopes the panel to one BOM import inside the match panel. */
export interface BomBackfillPanelProps {
  /** Persisted BOM import id passed to the API backfill routes. */
  bomImportId: string;
  /** Missing-part count from the latest match pass; enables the start action. */
  unmatchedCandidateCount: number;
}

/** BomBackfillPanelStatus tracks the client-side backfill view state. */
type BomBackfillPanelStatus =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "progress"; response: BomBackfillStatusResponse }
  | { kind: "failed"; message: string };

/**
 * Renders the batch import action plus polling progress for one BOM import's missing parts.
 */
export function BomBackfillPanel({ bomImportId, unmatchedCandidateCount }: BomBackfillPanelProps): React.ReactElement | null {
  const router = useRouter();
  const [status, setStatus] = useState<BomBackfillPanelStatus>({ kind: "loading" });
  const refreshedAfterSettle = useRef(false);

  /**
   * Reads current progress once; used on mount so a running batch survives page reloads.
   */
  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchBomBackfillStatus(bomImportId);

      if (response && response.summary.totalCount > 0) {
        setStatus({ kind: "progress", response });
      } else {
        setStatus({ kind: "idle" });
      }
    } catch {
      // A failed status read never blocks the match panel; the start action reports real errors.
      setStatus({ kind: "idle" });
    }
  }, [bomImportId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  /**
   * Polls progress while any request is still waiting on the worker, then refreshes the page
   * data once everything settles so newly imported parts show up in project context.
   */
  useEffect(() => {
    if (status.kind !== "progress" || status.response.summary.settled) {
      if (status.kind === "progress" && status.response.summary.settled && status.response.summary.importedCount > 0 && !refreshedAfterSettle.current) {
        refreshedAfterSettle.current = true;
        router.refresh();
      }

      return;
    }

    const timer = setTimeout(() => {
      void loadStatus();
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [loadStatus, router, status]);

  /**
   * Queues every missing part for background import and shows the first progress snapshot.
   */
  const onStart = useCallback(async () => {
    setStatus({ kind: "starting" });
    refreshedAfterSettle.current = false;

    try {
      const response = await startBomBackfill(bomImportId);
      setStatus({ kind: "progress", response });
    } catch (error) {
      setStatus({ kind: "failed", message: resolveBackfillFailure(error) });
    }
  }, [bomImportId]);

  if (status.kind === "loading") {
    return null;
  }

  // Nothing to offer: no missing parts from the latest match and no prior batch to report.
  if (status.kind === "idle" && unmatchedCandidateCount === 0) {
    return null;
  }

  const hasProgress = status.kind === "progress";
  const settled = hasProgress && status.response.summary.settled;
  const retryableCount = hasProgress
    ? status.response.summary.noMatchCount + status.response.summary.failedCount
    : 0;
  const showStartButton = (status.kind === "idle" || status.kind === "failed") && unmatchedCandidateCount > 0;
  const showRetryButton = settled && retryableCount > 0;

  return (
    <div className="bom-backfill-panel">
      {showStartButton ? (
        <button onClick={onStart} type="button">
          Import all {unmatchedCandidateCount} missing part{unmatchedCandidateCount === 1 ? "" : "s"}
        </button>
      ) : null}
      {status.kind === "starting" ? <p className="muted-copy">Queueing the missing parts...</p> : null}
      {status.kind === "failed" ? <p className="bom-backfill-panel__failed">{status.message}</p> : null}
      {hasProgress ? <BomBackfillProgress response={status.response} /> : null}
      {showRetryButton ? (
        <button onClick={onStart} type="button">
          Search again for the {retryableCount} part{retryableCount === 1 ? "" : "s"} not imported
        </button>
      ) : null}
      {hasProgress ? (
        <p className="muted-copy">
          Parts imported here start unreviewed, exactly like a one-at-a-time import. Importing never approves a part, validates its files, or makes it export-ready.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders the bucket badges plus the rows that still need a human: picks, not-found, failures.
 */
function BomBackfillProgress({ response }: { response: BomBackfillStatusResponse }): React.ReactElement {
  const { requests, summary } = response;
  const needsChoiceRows = requests.filter((row) => row.requestStatus === "needs_choice");
  const noMatchRows = requests.filter((row) => row.requestStatus === "no_match");
  const failedRows = requests.filter((row) => row.requestStatus === "failed");

  return (
    <div className="bom-backfill-panel__progress">
      <div className="bom-backfill-panel__badges">
        {summary.pendingCount > 0 ? <StatusBadge label={`${summary.pendingCount} searching suppliers`} tone="review" /> : null}
        <StatusBadge label={`${summary.importedCount} imported`} tone={summary.importedCount > 0 ? "verified" : "neutral"} />
        <StatusBadge label={`${summary.needsChoiceCount} need your pick`} tone={summary.needsChoiceCount > 0 ? "review" : "neutral"} />
        <StatusBadge label={`${summary.noMatchCount} not found`} tone={summary.noMatchCount > 0 ? "danger" : "neutral"} />
        {summary.failedCount > 0 ? <StatusBadge label={`${summary.failedCount} failed`} tone="danger" /> : null}
      </div>
      {summary.pendingCount > 0 ? (
        <p className="muted-copy">
          Searching supplier catalogs and importing in the background. This page checks progress automatically — you can keep working or come back later.
        </p>
      ) : null}
      {summary.settled && summary.importedCount > 0 ? (
        <p>
          {summary.importedCount} part{summary.importedCount === 1 ? " is" : "s are"} now in the catalog. Click <strong>Match rows</strong> again to link them to this BOM.
        </p>
      ) : null}
      {needsChoiceRows.length > 0 ? (
        <BomBackfillRowList
          heading={`${needsChoiceRows.length} part${needsChoiceRows.length === 1 ? "" : "s"} matched more than one catalog entry — pick the right one`}
          rows={needsChoiceRows}
          rowDetail={(row) => describeCandidates(row)}
        />
      ) : null}
      {noMatchRows.length > 0 ? (
        <BomBackfillRowList
          heading={`${noMatchRows.length} part${noMatchRows.length === 1 ? "" : "s"} not found at the configured suppliers`}
          rows={noMatchRows}
          rowDetail={() => "Check the MPN in your source file, or import it by hand with a supplier link or datasheet."}
        />
      ) : null}
      {failedRows.length > 0 ? (
        <BomBackfillRowList
          heading={`${failedRows.length} import${failedRows.length === 1 ? "" : "s"} failed`}
          rows={failedRows}
          rowDetail={(row) => row.errorMessage ?? "Import did not complete."}
        />
      ) : null}
    </div>
  );
}

/**
 * Renders one collapsible bucket of rows, each linking into the existing one-at-a-time import flow.
 */
function BomBackfillRowList({
  heading,
  rows,
  rowDetail
}: {
  heading: string;
  rows: BomBackfillRequestRecord[];
  rowDetail: (row: BomBackfillRequestRecord) => string;
}): React.ReactElement {
  return (
    <details className="bom-backfill-panel__rows">
      <summary>{heading}</summary>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              <span className="ui-mono">{row.mpn}</span>
              {row.manufacturerName ? ` / ${row.manufacturerName}` : ""}
              {" — "}
              {rowDetail(row)}
            </span>{" "}
            <Link href={`/catalog?q=${encodeURIComponent(row.mpn)}#quick-check`}>Review in catalog</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Summarizes the preserved supplier candidates for one needs-your-pick row.
 */
function describeCandidates(row: BomBackfillRequestRecord): string {
  if (row.candidates.length === 0) {
    return "Multiple catalog entries matched.";
  }

  const names = row.candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.manufacturerName || "unknown maker"} (${candidate.providerId})`)
    .join(", ");
  const suffix = row.candidates.length > 3 ? `, and ${row.candidates.length - 3} more` : "";

  return `Matched ${row.candidates.length} entries: ${names}${suffix}.`;
}

/**
 * Converts API failures into concise operator copy.
 */
function resolveBackfillFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Could not queue the missing parts. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Importing missing parts requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Importing missing parts requires the project-memory database.";
  }

  return error.message.replace(/^Missing-part import failed \([^)]+?\):\s*/u, "");
}
