/**
 * File header: Whole-library backfill wizard — scan the project files root, add folders as projects.
 *
 * One scan lists every mirror-root folder no library project claims yet, with the parts list the
 * document classifier found inside. "Add to library" (or "Add all") onboards each folder through
 * the server: a disclosed rename to the project-key form (contents untouched), project creation,
 * BOM import with auto-mapping, deterministic matching, and queueing missing parts for the
 * background worker. Every step's outcome renders honestly per folder — unrecognizable columns
 * park for a human mapping on the project page, and nothing is ever approved by onboarding.
 */

"use client";

import Link from "next/link";
import React, { useCallback, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { fetchProjectFolderScan, isApiClientError, onboardProjectFolder } from "../lib/api-client";
import type { ProjectFolderOnboardReport, ProjectFolderScanEntry, ProjectFolderScanResponse } from "@ee-library/shared/types";

/** ScanStatus tracks the folder-scan request state. */
type ScanStatus =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "ready"; response: ProjectFolderScanResponse }
  | { kind: "failed"; message: string };

/** FolderOnboardStatus tracks one folder's onboarding state inside the results table. */
type FolderOnboardStatus =
  | { kind: "running" }
  | { kind: "done"; report: ProjectFolderOnboardReport }
  | { kind: "failed"; message: string };

/**
 * Renders the scan action and the per-folder onboarding table.
 */
export function ProjectFolderScanPanel(): React.ReactElement {
  const [scan, setScan] = useState<ScanStatus>({ kind: "idle" });
  const [folderStatus, setFolderStatus] = useState<Record<string, FolderOnboardStatus>>({});
  const [addingAll, setAddingAll] = useState(false);

  /**
   * Runs one read-only scan of the mirror root.
   */
  const onScan = useCallback(async () => {
    setScan({ kind: "scanning" });
    setFolderStatus({});

    try {
      const response = await fetchProjectFolderScan();
      setScan({ kind: "ready", response });
    } catch (error) {
      setScan({ kind: "failed", message: resolveScanFailure(error) });
    }
  }, []);

  /**
   * Onboards one folder and records its honest per-step report. The parts-list path is the
   * row's explicit choice when the folder held more than one candidate.
   */
  const onAddFolder = useCallback(
    async (entry: ProjectFolderScanEntry, partsListRelativePath: string | null = entry.bestPartsListRelativePath) => {
      setFolderStatus((current) => ({ ...current, [entry.folderName]: { kind: "running" } }));

      try {
        const report = await onboardProjectFolder({
          folderName: entry.folderName,
          partsListRelativePath,
          projectName: entry.suggestedProjectName
        });
        // No router refresh here: the outcome row is the receipt, and it links straight into the
        // created project. The projects list above updates on the next navigation.
        setFolderStatus((current) => ({ ...current, [entry.folderName]: { kind: "done", report } }));
        return true;
      } catch (error) {
        setFolderStatus((current) => ({
          ...current,
          [entry.folderName]: { kind: "failed", message: resolveOnboardFailure(error) }
        }));
        return false;
      }
    },
    []
  );

  /**
   * Onboards every scanned folder one at a time so progress stays visible and the API stays calm.
   */
  const onAddAll = useCallback(
    async (entries: ProjectFolderScanEntry[]) => {
      setAddingAll(true);

      try {
        for (const entry of entries) {
          if (entry.renameCollision) {
            continue;
          }

          await onAddFolder(entry);
        }
      } finally {
        setAddingAll(false);
      }
    },
    [onAddFolder]
  );

  return (
    <div className="project-folder-scan">
      <p className="muted-copy">
        Copy old project folders into the project files root as-is, then scan. Each folder becomes a project, its parts
        list is imported, and missing parts are searched at your suppliers in the background. Scanning changes nothing on disk.
      </p>
      <button disabled={scan.kind === "scanning"} onClick={() => void onScan()} type="button">
        {scan.kind === "scanning" ? "Scanning folders..." : "Scan for project folders"}
      </button>
      {scan.kind === "failed" ? <p className="project-folder-scan__error">{scan.message}</p> : null}
      {scan.kind === "ready" ? (
        <ScanResults
          addingAll={addingAll}
          folderStatus={folderStatus}
          onAddAll={(entries) => void onAddAll(entries)}
          onAddFolder={(entry, partsListRelativePath) => void onAddFolder(entry, partsListRelativePath)}
          response={scan.response}
        />
      ) : null}
    </div>
  );
}

/**
 * Renders the scanned folders with per-row add actions and honest outcome summaries.
 */
function ScanResults({
  addingAll,
  folderStatus,
  onAddAll,
  onAddFolder,
  response
}: {
  addingAll: boolean;
  folderStatus: Record<string, FolderOnboardStatus>;
  onAddAll: (entries: ProjectFolderScanEntry[]) => void;
  onAddFolder: (entry: ProjectFolderScanEntry, partsListRelativePath: string | null) => void;
  response: ProjectFolderScanResponse;
}): React.ReactElement {
  const { unimportedFolders } = response;
  const pendingEntries = unimportedFolders.filter(
    (entry) => !entry.renameCollision && folderStatus[entry.folderName] === undefined
  );

  if (unimportedFolders.length === 0) {
    return (
      <p className="muted-copy">
        Every folder under <code className="ui-mono">{response.rootPath}</code> is already a project
        {response.skippedExistingCount > 0 ? ` (${response.skippedExistingCount} checked)` : ""}. Copy more project folders in and rescan.
      </p>
    );
  }

  return (
    <div className="project-folder-scan__results">
      <p className="muted-copy">
        {unimportedFolders.length} folder{unimportedFolders.length === 1 ? "" : "s"} under{" "}
        <code className="ui-mono">{response.rootPath}</code> {unimportedFolders.length === 1 ? "is" : "are"} not in the library yet
        {response.skippedExistingCount > 0 ? ` (${response.skippedExistingCount} already imported)` : ""}.
        {response.truncated ? " Showing the first batch — rescan after adding these." : ""}
      </p>
      {pendingEntries.length > 1 ? (
        <button disabled={addingAll} onClick={() => onAddAll(pendingEntries)} type="button">
          {addingAll ? "Adding projects..." : `Add all ${pendingEntries.length} to the library`}
        </button>
      ) : null}
      <table className="project-folder-scan__table">
        <thead>
          <tr>
            <th>Folder</th>
            <th>Parts list found</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {unimportedFolders.map((entry) => (
            <FolderRow
              addingAll={addingAll}
              entry={entry}
              key={entry.folderName}
              onAddFolder={onAddFolder}
              status={folderStatus[entry.folderName]}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders one scanned folder row: what was found, the disclosed rename, and the outcome.
 */
function FolderRow({
  addingAll,
  entry,
  onAddFolder,
  status
}: {
  addingAll: boolean;
  entry: ProjectFolderScanEntry;
  onAddFolder: (entry: ProjectFolderScanEntry, partsListRelativePath: string | null) => void;
  status: FolderOnboardStatus | undefined;
}): React.ReactElement {
  const importableCandidates = entry.partsListCandidates.filter((candidate) => candidate.importable);
  const [selectedPath, setSelectedPath] = useState(entry.bestPartsListRelativePath);
  const bestCandidate = entry.partsListCandidates.find((candidate) => candidate.relativePath === entry.bestPartsListRelativePath);

  return (
    <tr>
      <td>
        <span className="ui-mono">{entry.folderName}</span>
        <div className="muted-copy">
          {entry.fileCount} file{entry.fileCount === 1 ? "" : "s"} mapped
        </div>
        {entry.renameTarget !== entry.folderName ? (
          <div className="muted-copy">
            Will be renamed to <code className="ui-mono">{entry.renameTarget}</code> (contents untouched)
          </div>
        ) : null}
      </td>
      <td>
        {importableCandidates.length > 1 ? (
          // More than one parts list in the folder is a human decision, not a silent best-guess.
          <label className="project-folder-scan__picker">
            <span className="muted-copy">
              {importableCandidates.length} parts lists found - choose which one to import
            </span>
            <select
              disabled={status !== undefined}
              onChange={(event) => setSelectedPath(event.target.value || null)}
              value={selectedPath ?? ""}
            >
              {importableCandidates.map((candidate) => (
                <option key={candidate.relativePath} value={candidate.relativePath}>
                  {candidate.relativePath} ({Math.round(candidate.confidenceScore * 100)}% sure)
                </option>
              ))}
              <option value="">None - start the project empty</option>
            </select>
          </label>
        ) : bestCandidate ? (
          <>
            <code className="ui-mono">{bestCandidate.relativePath}</code>
            <div className="muted-copy">{Math.round(bestCandidate.confidenceScore * 100)}% sure - {bestCandidate.reason}</div>
          </>
        ) : (
          <span className="muted-copy">No importable parts list found - the project starts empty</span>
        )}
      </td>
      <td>
        {entry.renameCollision ? (
          <span className="muted-copy">
            A folder named <code className="ui-mono">{entry.renameTarget}</code> already exists - merge or rename by hand, then rescan
          </span>
        ) : (
          <FolderOutcome
            addingAll={addingAll}
            entry={entry}
            onAdd={() => onAddFolder(entry, selectedPath)}
            status={status}
          />
        )}
      </td>
    </tr>
  );
}

/**
 * Renders one folder's action button or its honest per-step onboarding outcome.
 */
function FolderOutcome({
  addingAll,
  onAdd,
  status
}: {
  addingAll: boolean;
  entry: ProjectFolderScanEntry;
  onAdd: () => void;
  status: FolderOnboardStatus | undefined;
}): React.ReactElement {
  if (!status) {
    return (
      <button disabled={addingAll} onClick={onAdd} type="button">
        Add to library
      </button>
    );
  }

  if (status.kind === "running") {
    return <span className="muted-copy">Adding...</span>;
  }

  if (status.kind === "failed") {
    return <span className="project-folder-scan__error">{status.message}</span>;
  }

  const { report } = status;

  if (report.projectOutcome !== "created" || !report.project) {
    return <span className="muted-copy">{report.message ?? "The project could not be created."}</span>;
  }

  const projectHref = `/projects/${encodeURIComponent(report.project.id)}`;

  return (
    <div className="project-folder-scan__outcome">
      <StatusBadge label="Project created" tone="verified" />
      {report.bomOutcome === "imported" && report.matchOutcome ? (
        <>
          <StatusBadge
            label={`${report.matchOutcome.matchedLineCount} matched / ${report.matchOutcome.unmatchedLineCount} missing`}
            tone={report.matchOutcome.unmatchedLineCount > 0 ? "review" : "verified"}
          />
          {report.backfillQueuedCount !== null && report.backfillQueuedCount > 0 ? (
            <StatusBadge label={`${report.backfillQueuedCount} part${report.backfillQueuedCount === 1 ? "" : "s"} searching suppliers`} tone="review" />
          ) : null}
        </>
      ) : null}
      {report.bomOutcome === "mapping_required" ? <StatusBadge label="Parts list needs your mapping" tone="review" /> : null}
      {report.bomOutcome === "failed" ? <StatusBadge label="Parts list not imported" tone="danger" /> : null}
      {report.message ? <div className="muted-copy">{report.message}</div> : null}
      <Link href={projectHref}>Open {report.project.name}</Link>
    </div>
  );
}

/**
 * Converts scan failures into concise operator copy.
 */
function resolveScanFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Could not scan the project folders. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Scanning project folders requires an admin session.";
  }

  if (error.code === "PROJECT_FILES_NOT_CONFIGURED") {
    return "The project file mirror is disabled on this server, so folders cannot be scanned.";
  }

  return error.message.replace(/^Project folder scan failed \([^)]+?\):\s*/u, "");
}

/**
 * Converts onboarding failures into concise operator copy.
 */
function resolveOnboardFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Could not add this folder. Check the API and try again.";
  }

  return error.message.replace(/^Project folder onboarding failed \([^)]+?\):\s*/u, "");
}
