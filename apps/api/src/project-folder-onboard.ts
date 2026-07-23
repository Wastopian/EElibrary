/**
 * File header: Turns one scanned mirror folder into a library project with its BOM, step by step.
 *
 * Composition over existing, individually-tested pieces: the disclosed folder rename (so the
 * project key resolves to the dropped folder on case-sensitive filesystems), project creation,
 * the from-file BOM read + auto-mapping, deterministic matching, and the batch missing-part
 * queue. Every step reports its outcome honestly and later steps degrade instead of guessing:
 * an unrecognizable MPN column parks as mapping_required for the project page's inline mapping,
 * and a failed step never rolls back the earlier ones — the report says exactly what happened.
 * Onboarding never approves, validates, or export-promotes anything.
 */

import { BomCsvParseError, buildBomImportPreview, hasMappedHeader } from "@ee-library/shared/bom-csv";
import { startBomBackfillForBomImport } from "./bom-backfill-store";
import { createBomImportInDatabase, createProjectInDatabase, matchBomImportRowsInDatabase } from "./project-memory-store";
import { readProjectBomSourceFile, renameFolderForOnboarding } from "./project-files";
import type { ProjectFolderOnboardInput, ProjectFolderOnboardReport } from "@ee-library/shared/types";

/** OnboardProjectFolderResult reports one onboarding run or the explicit setup states. */
export type OnboardProjectFolderResult =
  | { status: "not_configured" }
  | { status: "invalid"; code: string; message: string }
  | { status: "done"; report: ProjectFolderOnboardReport };

/**
 * Onboards one mirror-root folder: rename to key form, create the project, import the chosen
 * parts list, match, and queue missing parts for the background worker.
 */
export async function onboardProjectFolder(input: ProjectFolderOnboardInput, actorId: string): Promise<OnboardProjectFolderResult> {
  const folderName = input.folderName?.trim();

  if (!folderName) {
    return { code: "MISSING_FOLDER", message: "Choose one scanned folder to add.", status: "invalid" };
  }

  const revisionLabel = input.revisionLabel?.trim() || "A";
  const report: ProjectFolderOnboardReport = {
    backfillQueuedCount: null,
    bomImportId: null,
    bomOutcome: "skipped",
    folderName,
    matchOutcome: null,
    message: null,
    partsListRelativePath: input.partsListRelativePath?.trim() || null,
    project: null,
    projectOutcome: "failed",
    renamedTo: null
  };

  // Step 1: the disclosed rename, so the project key resolves to this folder everywhere.
  const renameResult = await renameFolderForOnboarding(folderName);

  if (renameResult.status === "not_configured") {
    return { status: "not_configured" };
  }

  if (renameResult.status !== "ok") {
    return { code: renameResult.status === "collision" ? "FOLDER_NAME_TAKEN" : "INVALID_FOLDER", message: renameResult.message, status: "invalid" };
  }

  report.renamedTo = renameResult.renamed ? renameResult.renamedTo : null;

  // Step 2: create the project. The key is exactly the folder's renamed form.
  const createResult = await createProjectInDatabase({
    initialRevisionLabel: revisionLabel,
    name: input.projectName?.trim() || buildDefaultProjectName(folderName),
    projectKey: renameResult.renamedTo
  });

  if (createResult.status === "not_configured") {
    return { status: "not_configured" };
  }

  if (createResult.status === "conflict") {
    report.projectOutcome = "already_exists";
    report.message = "A project already uses this folder's key. Open it from the project list instead.";
    return { report, status: "done" };
  }

  const project = createResult.response.project;
  report.project = { id: project.id, name: project.name, projectKey: project.projectKey };
  report.projectOutcome = "created";

  // Step 3: the BOM, when a parts-list file was chosen.
  if (!report.partsListRelativePath) {
    report.message = "No parts list was chosen, so the project starts empty. Upload or import one from the project page.";
    return { report, status: "done" };
  }

  const source = await readProjectBomSourceFile({ id: project.id, projectKey: project.projectKey }, report.partsListRelativePath);

  if (source.status !== "ok") {
    report.bomOutcome = "failed";
    report.message = source.status === "not_configured"
      ? "The project file mirror is disabled on this server."
      : source.message;
    return { report, status: "done" };
  }

  let mapping;

  try {
    const preview = buildBomImportPreview(source.response);
    mapping = hasMappedHeader(preview.headers, preview.suggestedMapping.mpn ?? null) ? preview.suggestedMapping : null;
  } catch (error) {
    if (error instanceof BomCsvParseError) {
      report.bomOutcome = "failed";
      report.message = error.message;
      return { report, status: "done" };
    }

    throw error;
  }

  if (!mapping) {
    report.bomOutcome = "mapping_required";
    report.message = "The parts list's MPN column was not recognizable. Open the project page and map the columns by hand — nothing was imported.";
    return { report, status: "done" };
  }

  const bomResult = await createBomImportInDatabase(
    project.id,
    {
      columnMapping: mapping,
      rawContent: source.response.rawContent,
      revisionLabel,
      sourceFilename: source.response.sourceFilename,
      sourceFormat: source.response.sourceFormat
    },
    actorId
  );

  if (bomResult.status !== "created") {
    report.bomOutcome = "failed";
    report.message = bomResult.status === "invalid" ? bomResult.message : "Saving the parts list did not complete.";
    return { report, status: "done" };
  }

  report.bomImportId = bomResult.response.bomImport.id;
  report.bomOutcome = "imported";

  // Step 4: deterministic matching, then queue whatever is missing for the background worker.
  const matchResult = await matchBomImportRowsInDatabase(report.bomImportId);

  if (matchResult.status !== "matched") {
    report.message = "Rows were saved but matching did not run. Run Match rows from the project page.";
    return { report, status: "done" };
  }

  report.matchOutcome = {
    matchedLineCount: matchResult.response.summary.matchedLineCount,
    unmatchedLineCount: matchResult.response.summary.unmatchedLineCount,
    usageCount: matchResult.response.summary.usageCreatedOrUpdatedCount
  };

  if (matchResult.response.summary.unmatchedLineCount > 0) {
    const backfillResult = await startBomBackfillForBomImport(report.bomImportId, actorId);

    if (backfillResult.status === "created") {
      report.backfillQueuedCount = backfillResult.response.summary.pendingCount;
    } else {
      report.message = "Missing parts were found but could not be queued for import. Use Import all missing parts on the project page.";
    }
  }

  return { report, status: "done" };
}

/**
 * Derives a plain project name from the folder name when the caller supplies none.
 */
function buildDefaultProjectName(folderName: string): string {
  const spaced = folderName.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();

  return spaced.length > 0 ? spaced : folderName;
}
