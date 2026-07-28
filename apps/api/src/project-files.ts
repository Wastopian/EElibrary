/**
 * File header: Project file mirror service.
 *
 * Persists project files outside the database so engineers can also drop files directly
 * into operating-system folders. For each project the service maintains first-class
 * subfolders for parts lists, datasheets, 3D models, internal hardware, and notes.
 *
 * The root resolves in this order:
 *   1. The `EE_LIBRARY_PROJECT_FILES_ROOT` environment variable (absolute or relative).
 *   2. The default `<user-home>/EE-Library/projects` location (per the operator's
 *      preference for keeping shared assets outside the source tree).
 *
 * Path safety: project keys are sanitized before they are joined to the root and the
 * resolved per-project path is asserted to live inside the root. This refuses path
 * traversal regardless of how a project key was persisted upstream.
 */

import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import type {
  ProjectCustomHardwareListing,
  ProjectCustomHardwareRecord,
  Project,
  ProjectDocumentCopyInput,
  ProjectDocumentCopyResponse,
  ProjectDocumentExtractionSourceLocation,
  ProjectDocumentExtractionState,
  ProjectDocumentFolderPattern,
  ProjectDocumentFolderPatternAction,
  ProjectDocumentMap,
  ProjectDocumentMapEntry,
  ProjectDocumentSignals,
  ProjectDocumentSortPlan,
  ProjectDocumentTypeCount,
  ProjectDocumentType,
  ProjectFilesAvailability,
  ProjectFilesResponse,
  ProjectFolderScanEntry,
  ProjectFolderScanResponse,
  ProjectFileUploadInput,
  ProjectFolderCategory,
  ProjectFolderEntry,
  ProjectFolderListing,
  WhereUsedDocumentHitRecord
} from "@ee-library/shared/types";

/** ProjectFolderDefinition pairs a category with the on-disk folder name and friendly copy. */
interface ProjectFolderDefinition {
  category: ProjectFolderCategory;
  /** On-disk subfolder name. Stable so engineers can rely on it for direct copy/paste. */
  folderName: string;
  /** Short human-readable label rendered above the file list. */
  label: string;
  /** Short description of what belongs inside the folder. */
  description: string;
}

/**
 * PROJECT_FOLDER_DEFINITIONS is the canonical list of subfolders created per project.
 * Order is preserved so the UI renders categories in a consistent, scannable sequence.
 */
export const PROJECT_FOLDER_DEFINITIONS: readonly ProjectFolderDefinition[] = [
  {
    category: "parts_list",
    folderName: "parts-list",
    label: "Parts list",
    description: "BOM exports, CSV imports, and other parts list source files."
  },
  {
    category: "hardware",
    folderName: "hardware",
    label: "Custom designs",
    description: "Internal boards, fixtures, harnesses, adapters, cables, and test hardware."
  },
  {
    category: "datasheets",
    folderName: "datasheets",
    label: "Datasheets",
    description: "Manufacturer datasheets, app notes, and reference documents."
  },
  {
    category: "models",
    folderName: "models",
    label: "3D models",
    description: "Mechanical CAD, STEP/STL exports, and 3D viewer assets."
  },
  {
    category: "notes",
    folderName: "notes",
    label: "Notes",
    description: "Engineer notes about candidate parts, decisions, and trade-offs."
  }
] as const;

/**
 * MAX_PROJECT_FILE_BYTES bounds one upload through the JSON+base64 transport. Mirrors
 * the size envelope used by evidence uploads so the limits feel consistent across the
 * project memory surface.
 */
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

/** ProjectFilesProjectInput minimally identifies a project for file mirror operations. */
export interface ProjectFilesProjectInput {
  /** Database id used for the response payload. */
  id: string;
  /** Project key used as the on-disk folder name (after sanitization). */
  projectKey: string;
}

/**
 * Returns the absolute project file mirror root, or null when explicitly disabled.
 *
 * Setting `EE_LIBRARY_PROJECT_FILES_ROOT=off` disables the mirror. An empty value is
 * treated the same as an unset value so copied example env files still get the local
 * default folder.
 */
export function getProjectFilesRoot(): string | null {
  const raw = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "off") {
      return null;
    }
    if (trimmed.length === 0) {
      return path.resolve(homedir(), "EE-Library", "projects");
    }
    return path.resolve(trimmed);
  }

  return path.resolve(homedir(), "EE-Library", "projects");
}

/**
 * Builds the project mirror response for one project.
 *
 * Auto-creates the project folder structure on first access so engineers always see the
 * expected subfolders, even if no files have been imported yet. Filesystem failures
 * surface as `availability: "error"` with a single human-readable message; the response
 * never silently hides drift or mistakes.
 */
export async function buildProjectFilesResponse(project: ProjectFilesProjectInput): Promise<ProjectFilesResponse> {
  const root = getProjectFilesRoot();
  const safeKey = sanitizeProjectKey(project.projectKey);

  if (!root) {
    return {
      availability: "not_configured",
      rootPath: null,
      projectId: project.id,
      projectKey: safeKey,
      folders: [],
      customHardware: null,
      documentMap: null,
      message: null
    };
  }

  const projectRoot = resolveProjectRoot(root, safeKey);

  try {
    await ensureProjectFolderTree(projectRoot);
    const folders = await readFolderListings(projectRoot);
    const customHardware = await readCustomHardwareListing(projectRoot);
    const documentMap = await buildProjectDocumentMap(projectRoot);

    return {
      availability: "configured",
      rootPath: projectRoot,
      projectId: project.id,
      projectKey: safeKey,
      folders,
      customHardware,
      documentMap,
      message: null
    };
  } catch (error) {
    return {
      availability: "error",
      rootPath: projectRoot,
      projectId: project.id,
      projectKey: safeKey,
      folders: [],
      customHardware: null,
      documentMap: null,
      message: error instanceof Error ? error.message : "Project file mirror is unavailable."
    };
  }
}

/**
 * Searches current project document maps for connector, pin, cable, fixture, signal,
 * revision, filename, and document-type clues.
 *
 * This is intentionally a live bounded scan of the same file mirror that project detail
 * renders. No separate index is claimed, and unreadable project folders are skipped so a
 * single stale share does not block other projects from returning useful hits.
 */
export async function searchProjectDocumentsForWhereUsed(
  projects: Project[],
  query: string,
  readExtractions?: (
    projectId: string,
    searchValues: string[]
  ) => Promise<ProjectDocumentExtractionRecordInput[]>
): Promise<WhereUsedDocumentHitRecord[]> {
  const root = getProjectFilesRoot();
  const needle = buildProjectDocumentSearchNeedle(query);
  if (!root || !needle) {
    return [];
  }

  const hits: WhereUsedDocumentHitRecord[] = [];
  const extractionSearchValues = buildProjectDocumentExtractionSearchValues(needle);
  for (const project of projects.slice(0, DOCUMENT_SEARCH_MAX_PROJECTS)) {
    if (hits.length >= DOCUMENT_SEARCH_MAX_HITS) {
      break;
    }

    try {
      const safeKey = sanitizeProjectKey(project.projectKey);
      const projectRoot = resolveProjectRoot(root, safeKey);
      await ensureProjectFolderTree(projectRoot);
      const rawDocumentMap = await buildProjectDocumentMap(projectRoot);
      const extractionRecords = readExtractions
        ? await readExtractions(project.id, extractionSearchValues)
        : [];
      const extractionRecordsByPath = new Map(
        extractionRecords.map((record) => [record.relativePath, record])
      );
      const documentMap =
        extractionRecords.length > 0
          ? applyProjectDocumentExtractionsToMap(rawDocumentMap, extractionRecords)
          : rawDocumentMap;

      for (const document of documentMap.documents) {
        const matchedLabels = matchProjectDocumentToSearchNeedle(document, needle);
        if (matchedLabels.length === 0) {
          continue;
        }

        const extractionRecord = extractionRecordsByPath.get(document.relativePath);
        const sourceLabels = extractionRecord
          ? matchExtractionSourceLocations(extractionRecord.sourceSegments, needle)
          : [];
        hits.push({
          document,
          matchedLabels: [...matchedLabels, ...sourceLabels],
          project
        });
        if (hits.length >= DOCUMENT_SEARCH_MAX_HITS) {
          break;
        }
      }
    } catch {
      continue;
    }
  }

  return hits.sort(compareWhereUsedDocumentHits);
}

/**
 * Chooses the narrowest useful clues for the database's coarse full-text filter.
 *
 * Explicit engineering identifiers take priority. Plain words are used only when the
 * question does not contain connector, pin, cable, fixture, revision, or signal clues.
 */
function buildProjectDocumentExtractionSearchValues(
  needle: ProjectDocumentSearchNeedle
): string[] {
  const signalValues = Object.values(needle.signals).flat();
  return signalValues.length > 0 ? signalValues : needle.tokens;
}

/**
 * Sanitizes a project key into a safe directory segment.
 *
 * Allows letters, digits, dashes, underscores, and dots. Anything else is replaced with a
 * dash to avoid surprises across Windows, macOS, and Linux. Keys collapsing to an empty
 * string (e.g. all whitespace) fall back to "project" so the mirror still has a valid
 * folder.
 */
export function sanitizeProjectKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  const filtered = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");

  return filtered.length > 0 ? filtered : "project";
}

/**
 * Resolves and asserts that `<root>/<key>` stays inside `<root>`. Throws if a malformed
 * key would escape the root, even after sanitization.
 */
function resolveProjectRoot(root: string, sanitizedKey: string): string {
  const candidate = path.resolve(root, sanitizedKey);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved project folder escapes the configured root: ${candidate}`);
  }

  return candidate;
}

/**
 * Ensures the project root and its category subfolders exist on disk. Idempotent:
 * existing folders are preserved exactly so engineers can drop files in directly.
 */
async function ensureProjectFolderTree(projectRoot: string): Promise<void> {
  await mkdir(projectRoot, { recursive: true });
  for (const folder of PROJECT_FOLDER_DEFINITIONS) {
    await mkdir(path.join(projectRoot, folder.folderName), { recursive: true });
  }
}

/**
 * Reads filesystem entries inside each category folder and returns a stable, sorted listing.
 * Hidden files starting with "." and the macOS `.DS_Store` cruft are skipped to keep the
 * UI calm without losing the engineer's actual deliverables.
 */
async function readFolderListings(projectRoot: string): Promise<ProjectFolderListing[]> {
  const listings: ProjectFolderListing[] = [];

  for (const folder of PROJECT_FOLDER_DEFINITIONS) {
    const absolutePath = path.join(projectRoot, folder.folderName);
    const entries = await readDirectoryEntries(absolutePath);

    listings.push({
      category: folder.category,
      label: folder.label,
      description: folder.description,
      absolutePath,
      entries
    });
  }

  return listings;
}

/** DEFAULT_CUSTOM_HARDWARE_PREFIXES covers the team's common internal hardware families. */
const DEFAULT_CUSTOM_HARDWARE_PREFIXES = ["PTA", "PCA", "ICD"] as const;

/**
 * CUSTOM_HARDWARE_PART_NUMBER_PATTERN recognizes internal custom-design folder names
 * without knowing the prefix ahead of time. It is only used on the dedicated hardware
 * folder so broad manufacturer MPNs in BOM files do not become accidental custom designs.
 */
const CUSTOM_HARDWARE_PART_NUMBER_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,19})[-._](\d{1,12})$/u;

/**
 * CUSTOM_HARDWARE_METADATA_FILENAMES lists metadata files read from inside each
 * custom design folder.
 * The first readable file wins so structured JSON and hand-written notes do not
 * get merged into a misleading combined record.
 */
const CUSTOM_HARDWARE_METADATA_FILENAMES = [
  "hardware.json",
  "metadata.json",
  "manifest.json",
  "info.json",
  "README.md",
  "readme.md",
  "hardware.md",
  "metadata.md",
  "info.md",
  "notes.md"
] as const;

/** MAX_PARTS_LIST_SCAN_BYTES bounds passive custom-hardware reference scanning for one source file. */
const MAX_PARTS_LIST_SCAN_BYTES = 2 * 1024 * 1024;

/** PARTS_LIST_REFERENCE_EXTENSIONS names text-like parts-list files scanned for custom design numbers. */
const PARTS_LIST_REFERENCE_EXTENSIONS = new Set([".csv", ".tsv", ".txt", ".md", ".json"]);

/** DOCUMENT_MAP_BOUNDARY_COPY explains that the Area 1 scan is a folder map, not review. */
const DOCUMENT_MAP_BOUNDARY_COPY =
  "This map uses filenames, small text files, and completed PDF or Office reading as hints. A listed document has not been reviewed, approved, or checked for reuse.";

/** DOCUMENT_MAP_MAX_FILES caps one scan so a copied shared-drive folder cannot stall the API. */
const DOCUMENT_MAP_MAX_FILES = 500;

/** DOCUMENT_MAP_MAX_DEPTH caps recursive folder reads inside one project mirror. */
const DOCUMENT_MAP_MAX_DEPTH = 6;

/** DOCUMENT_MAP_TEXT_SCAN_BYTES limits content reads to small text-like files. */
const DOCUMENT_MAP_TEXT_SCAN_BYTES = 256 * 1024;

/** DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD marks rows that should be sorted by a person. */
const DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD = 0.7;

/** DOCUMENT_MAP_MAX_FOLDER_PATTERNS keeps folder-level trend hints scannable. */
const DOCUMENT_MAP_MAX_FOLDER_PATTERNS = 10;

/** DOCUMENT_MAP_FOLDER_PATTERN_MIN_FILES requires repetition before calling something a folder trend. */
const DOCUMENT_MAP_FOLDER_PATTERN_MIN_FILES = 2;

/** DOCUMENT_MAP_FOLDER_DOMINANT_SHARE is the majority share needed for one dominant folder trend. */
const DOCUMENT_MAP_FOLDER_DOMINANT_SHARE = 0.6;

/** DOCUMENT_MAP_TEXT_EXTENSIONS names file types safe to read as UTF-8 snippets. */
const DOCUMENT_MAP_TEXT_EXTENSIONS = new Set([
  ".cfg",
  ".csv",
  ".htm",
  ".html",
  ".ini",
  ".json",
  ".kicad_pcb",
  ".kicad_sch",
  ".log",
  ".md",
  ".net",
  ".schdoc",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

/** DOCUMENT_MAP_IGNORED_FOLDER_NAMES names common non-project folders skipped during scans. */
const DOCUMENT_MAP_IGNORED_FOLDER_NAMES = new Set([
  "$recycle.bin",
  ".git",
  ".svn",
  "node_modules",
  "thumbs.db",
  "__macosx"
]);

/** DOCUMENT_SEARCH_MAX_PROJECTS bounds global where-used scans over project folders. */
const DOCUMENT_SEARCH_MAX_PROJECTS = 60;

/** DOCUMENT_SEARCH_MAX_HITS keeps global document where-used payloads scannable. */
const DOCUMENT_SEARCH_MAX_HITS = 80;

/** DOCUMENT_SEARCH_STOP_WORDS removes question wording while keeping engineering clues. */
const DOCUMENT_SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "by",
  "cable",
  "cables",
  "connector",
  "connectors",
  "doc",
  "docs",
  "document",
  "documents",
  "does",
  "file",
  "files",
  "for",
  "from",
  "fixture",
  "fixtures",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "pin",
  "pins",
  "revision",
  "revisions",
  "show",
  "signal",
  "signals",
  "that",
  "the",
  "this",
  "to",
  "use",
  "used",
  "uses",
  "what",
  "where",
  "which",
  "with"
]);

/** DocumentTypeCandidate is one possible classification for a scanned file. */
interface DocumentTypeCandidate {
  documentType: ProjectDocumentType;
  reason: string;
  score: number;
}

/** ProjectDocumentScanState carries bounded recursive scan results. */
interface ProjectDocumentScanState {
  documents: ProjectDocumentMapEntry[];
  folderCount: number;
  skippedCount: number;
}

/** ProjectDocumentClassification is the selected first-pass file classification. */
interface ProjectDocumentClassification {
  documentType: ProjectDocumentType;
  reason: string;
  score: number;
  suggestedCategory: ProjectFolderCategory | null;
}

/** ProjectDocumentSortPlanInput keeps sort-plan decisions explicit at the call site. */
interface ProjectDocumentSortPlanInput {
  classification: ProjectDocumentClassification;
  currentCategory: ProjectFolderCategory | null;
  filename: string;
  relativePath: string;
  signals: ProjectDocumentSignals;
}

/** ProjectDocumentSearchNeedle is the normalized query used for document-hit scans. */
interface ProjectDocumentSearchNeedle {
  /** Original trimmed query used for fallback matching. */
  rawQuery: string;
  /** Lowercase tokens that remain after dropping non-engineering question words. */
  tokens: string[];
  /** Engineering clues extracted from the query itself. */
  signals: ProjectDocumentSignals;
  /** Document families implied by query wording such as "test procedure". */
  documentTypes: ProjectDocumentType[];
}

/**
 * ProjectDocumentExtractionRecordInput carries persisted extraction text into the
 * filesystem-backed document map without exposing the full text in API responses.
 */
export interface ProjectDocumentExtractionRecordInput {
  /** Relative path matching one document-map row. */
  relativePath: string;
  /** User-facing extraction state attached to the row. */
  state: ProjectDocumentExtractionState;
  /** Bounded extracted text used only for classification and search signals. */
  extractedText: string | null;
  /** Extracted source segments retained for query-specific location matching. */
  sourceSegments: Array<ProjectDocumentExtractionSourceLocation & { text: string }>;
}

/** CustomHardwareMetadataFields is the normalized shape read from one metadata file. */
interface CustomHardwareMetadataFields {
  connectsTo: string | null;
  tests: string | null;
  attachedProject: string | null;
  notes: string | null;
}

/** CustomHardwareMetadataReadResult adds source filename and mtime provenance to parsed metadata. */
interface CustomHardwareMetadataReadResult extends CustomHardwareMetadataFields {
  metadataSource: string;
  modifiedAt: string | null;
}

/**
 * Returns the configured custom-hardware prefixes used as scan seeds.
 *
 * Teams can set `EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES=PTA,PCA,ICD,XYZ` to match their
 * own internal codes. Values are normalized to uppercase alphanumerics; invalid or empty
 * input falls back to the default set. Additional prefixes are discovered from real
 * design folders during a project read.
 */
export function getCustomHardwarePrefixes(): string[] {
  const raw = process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES;
  const source = typeof raw === "string" && raw.trim().length > 0
    ? raw.split(/[,\s;]+/u)
    : [...DEFAULT_CUSTOM_HARDWARE_PREFIXES];
  const cleaned = source
    .map((prefix) => normalizeCustomHardwarePrefix(prefix))
    .filter((prefix): prefix is string => Boolean(prefix));
  const unique = sortedStrings(cleaned);

  return unique.length > 0 ? unique : sortedStrings(DEFAULT_CUSTOM_HARDWARE_PREFIXES);
}

/**
 * Reads custom internal hardware for one project from the file mirror.
 *
 * A record is created for every recognized or discoverable `<prefix>-<number>` folder
 * under `hardware/`. Parts-list files are scanned only for configured/default prefixes
 * plus prefixes discovered from real folders; that keeps public catalog MPNs from being
 * misclassified while still catching team-specific hardware families.
 */
async function readCustomHardwareListing(projectRoot: string): Promise<ProjectCustomHardwareListing> {
  const hardwareFolderPath = path.join(projectRoot, "hardware");
  const partsListFolderPath = path.join(projectRoot, "parts-list");
  const recordsByPartNumber = new Map<string, ProjectCustomHardwareRecord>();

  const hardwareEntries = await readdir(hardwareFolderPath, { withFileTypes: true });
  const visibleHardwareFolders = hardwareEntries.filter((entry) => !entry.name.startsWith(".") && entry.isDirectory());
  const recognizedPrefixes = resolveCustomHardwarePrefixes(visibleHardwareFolders.map((entry) => entry.name), getCustomHardwarePrefixes());
  const partsListReferences = await readCustomHardwareReferencesFromPartsList(partsListFolderPath, recognizedPrefixes);

  for (const entry of visibleHardwareFolders) {
    const partNumber = canonicalizeCustomHardwarePartNumber(entry.name, recognizedPrefixes);
    if (!partNumber) {
      continue;
    }

    const folderPath = path.join(hardwareFolderPath, entry.name);
    const folderInfo = await stat(folderPath);
    const metadata = await readCustomHardwareMetadata(folderPath, partNumber);

    recordsByPartNumber.set(partNumber, {
      absolutePath: folderPath,
      attachedProject: metadata?.attachedProject ?? null,
      connectsTo: metadata?.connectsTo ?? null,
      folderName: entry.name,
      folderState: "folder_backed",
      mentionedInPartsListFiles: sortedStrings(partsListReferences.get(partNumber) ?? []),
      metadataSource: metadata?.metadataSource ?? null,
      modifiedAt: metadata?.modifiedAt ?? folderInfo.mtime.toISOString(),
      notes: metadata?.notes ?? null,
      partNumber,
      tests: metadata?.tests ?? null
    });
  }

  for (const [partNumber, sourceFiles] of partsListReferences) {
    if (recordsByPartNumber.has(partNumber)) {
      continue;
    }

    recordsByPartNumber.set(partNumber, {
      absolutePath: null,
      attachedProject: null,
      connectsTo: null,
      folderName: null,
      folderState: "parts_list_reference_only",
      mentionedInPartsListFiles: sortedStrings(sourceFiles),
      metadataSource: null,
      modifiedAt: null,
      notes: null,
      partNumber,
      tests: null
    });
  }

  return {
    boundary: "Custom design notes are records only. They do not check hardware, approve a BOM row, or make files ready to export.",
    hardwareFolderPath,
    recognizedPrefixes,
    records: Array.from(recordsByPartNumber.values()).sort(compareCustomHardwareRecords)
  };
}

/**
 * Builds a bounded recursive document map for one project folder.
 *
 * The scan is intentionally deterministic and conservative: it reads filenames for every
 * file, reads content only for small text-like files, and marks uncertain rows for
 * sorting instead of treating classifications as reviewed metadata.
 */
async function buildProjectDocumentMap(projectRoot: string): Promise<ProjectDocumentMap> {
  const state: ProjectDocumentScanState = {
    documents: [],
    folderCount: 0,
    skippedCount: 0
  };

  await scanProjectDocumentFolder(projectRoot, projectRoot, 0, state);

  const documents = state.documents.sort(compareProjectDocumentMapEntries);
  const folderPatterns = buildProjectDocumentFolderPatterns(documents);
  const summary = buildProjectDocumentMapSummary(documents, folderPatterns, state.folderCount, state.skippedCount);

  return {
    boundary: DOCUMENT_MAP_BOUNDARY_COPY,
    documents,
    folderPatterns,
    generatedAt: new Date().toISOString(),
    maxDepth: DOCUMENT_MAP_MAX_DEPTH,
    maxFiles: DOCUMENT_MAP_MAX_FILES,
    scanRootPath: projectRoot,
    summary
  };
}

/**
 * Applies persisted PDF/Office extraction records to a file-mirror response.
 *
 * Successful extracted text can improve type classification and engineering clue
 * discovery. The original filesystem path, size, and timestamps remain the source of
 * truth, while extraction progress stays a separate user-facing state.
 */
export function applyProjectDocumentExtractions(
  response: ProjectFilesResponse,
  records: ProjectDocumentExtractionRecordInput[]
): ProjectFilesResponse {
  if (!response.documentMap || records.length === 0) {
    return response;
  }

  return {
    ...response,
    documentMap: applyProjectDocumentExtractionsToMap(response.documentMap, records)
  };
}

/** Applies persisted extraction records directly to one document map. */
export function applyProjectDocumentExtractionsToMap(
  documentMap: ProjectDocumentMap,
  records: ProjectDocumentExtractionRecordInput[]
): ProjectDocumentMap {
  if (records.length === 0) {
    return documentMap;
  }

  const recordsByPath = new Map(records.map((record) => [normalizeRelativePath(record.relativePath), record]));
  const documents = documentMap.documents.map((entry) => {
    const record = recordsByPath.get(entry.relativePath);
    if (!record) {
      return entry;
    }

    if (record.state.status !== "succeeded" || !record.extractedText) {
      return {
        ...entry,
        extraction: record.state
      };
    }

    const extractedSignals = extractProjectDocumentSignals(record.extractedText);
    const signals = mergeProjectDocumentSignals([entry.signals, extractedSignals]);
    const extractedClassification = classifyProjectDocument(
      entry.relativePath,
      entry.filename,
      record.extractedText,
      signals
    );
    const classification =
      extractedClassification.score > entry.confidenceScore ||
      entry.documentType === "unknown"
        ? extractedClassification
        : {
            documentType: entry.documentType,
            reason: entry.reason,
            score: entry.confidenceScore,
            suggestedCategory: entry.suggestedCategory
          };
    const sortPlan = buildProjectDocumentSortPlan({
      classification,
      currentCategory: entry.currentCategory,
      filename: entry.filename,
      relativePath: entry.relativePath,
      signals
    });

    return {
      ...entry,
      confidenceScore: classification.score,
      documentType: classification.documentType,
      extraction: record.state,
      needsAttention:
        entry.outsideStandardFolders ||
        classification.documentType === "unknown" ||
        classification.score < DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD ||
        (classification.suggestedCategory !== null &&
          entry.currentCategory !== null &&
          classification.suggestedCategory !== entry.currentCategory),
      reason:
        classification === extractedClassification
          ? `${classification.reason} Read from ${record.state.sourceUnitCount ?? "document"} source section${record.state.sourceUnitCount === 1 ? "" : "s"}.`
          : entry.reason,
      signals,
      sortPlan,
      suggestedCategory: classification.suggestedCategory
    };
  });
  const folderPatterns = buildProjectDocumentFolderPatterns(documents);

  return {
    ...documentMap,
    documents: documents.sort(compareProjectDocumentMapEntries),
    folderPatterns,
    summary: buildProjectDocumentMapSummary(
      documents,
      folderPatterns,
      documentMap.summary.folderCount,
      documentMap.summary.skippedCount
    )
  };
}

/**
 * Recursively scans one folder under the project root while respecting file and depth
 * caps. Symlinks and hidden/system entries are skipped so the scan stays inside the
 * mirror and avoids noisy operating-system files.
 */
async function scanProjectDocumentFolder(
  projectRoot: string,
  folderPath: string,
  depth: number,
  state: ProjectDocumentScanState
): Promise<void> {
  if (depth > DOCUMENT_MAP_MAX_DEPTH) {
    state.skippedCount += 1;
    return;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(folderPath, { withFileTypes: true });
  } catch {
    state.skippedCount += 1;
    return;
  }

  state.folderCount += 1;
  const visibleEntries = entries
    .filter((entry) => !shouldSkipDocumentMapEntry(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

  for (const entry of visibleEntries) {
    const absolutePath = path.join(folderPath, entry.name);

    if (entry.isSymbolicLink()) {
      state.skippedCount += 1;
      continue;
    }

    if (entry.isDirectory()) {
      if (DOCUMENT_MAP_IGNORED_FOLDER_NAMES.has(entry.name.toLowerCase())) {
        state.skippedCount += 1;
        continue;
      }
      await scanProjectDocumentFolder(projectRoot, absolutePath, depth + 1, state);
      continue;
    }

    if (!entry.isFile()) {
      state.skippedCount += 1;
      continue;
    }

    if (state.documents.length >= DOCUMENT_MAP_MAX_FILES) {
      state.skippedCount += 1;
      continue;
    }

    const documentEntry = await buildProjectDocumentMapEntry(projectRoot, absolutePath);
    if (documentEntry) {
      state.documents.push(documentEntry);
    } else {
      state.skippedCount += 1;
    }
  }
}

/**
 * Builds one document-map row from filesystem stats, filename clues, and a small text
 * preview when the file type is safe to read.
 */
async function buildProjectDocumentMapEntry(projectRoot: string, absolutePath: string): Promise<ProjectDocumentMapEntry | null> {
  let info: Stats;
  try {
    info = await stat(absolutePath);
  } catch {
    return null;
  }

  if (!info.isFile()) {
    return null;
  }

  const relativePath = normalizeRelativePath(path.relative(projectRoot, absolutePath));
  const filename = path.basename(absolutePath);
  const parentFolder = normalizeRelativePath(path.dirname(relativePath));
  const textPreview = await readDocumentTextPreview(absolutePath, info.size);
  const searchText = [relativePath, filename, textPreview].filter(Boolean).join("\n");
  const signals = extractProjectDocumentSignals(searchText);
  const classification = classifyProjectDocument(relativePath, filename, textPreview, signals);
  const currentCategory = readProjectCategoryFromRelativePath(relativePath);
  const outsideStandardFolders = currentCategory === null;
  const sortPlan = buildProjectDocumentSortPlan({
    classification,
    currentCategory,
    filename,
    relativePath,
    signals
  });
  const needsAttention =
    outsideStandardFolders ||
    classification.documentType === "unknown" ||
    classification.score < DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD ||
    (classification.suggestedCategory !== null && currentCategory !== null && classification.suggestedCategory !== currentCategory);

  return {
    confidenceScore: classification.score,
    currentCategory,
    documentType: classification.documentType,
    extraction: null,
    filename,
    id: `doc-${relativePath.replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase() || "project-file"}`,
    modifiedAt: info.mtime.toISOString(),
    needsAttention,
    outsideStandardFolders,
    parentFolder: parentFolder === "." ? "." : parentFolder,
    reason: classification.reason,
    relativePath,
    signals,
    sizeBytes: info.size,
    sortPlan,
    suggestedCategory: classification.suggestedCategory
  };
}

/** Builds document-map counts after filesystem scan and optional extraction enrichment. */
function buildProjectDocumentMapSummary(
  documents: ProjectDocumentMapEntry[],
  folderPatterns: ProjectDocumentFolderPattern[],
  folderCount: number,
  skippedCount: number
): ProjectDocumentMap["summary"] {
  return {
    connectorMentionCount: documents.filter((entry) => entry.signals.connectorRefs.length > 0).length,
    documentCount: documents.length,
    extractionFailedCount: documents.filter((entry) => entry.extraction?.status === "failed").length,
    extractionQueuedCount: documents.filter((entry) => entry.extraction?.status === "queued").length,
    extractionRunningCount: documents.filter((entry) => entry.extraction?.status === "running").length,
    extractionSucceededCount: documents.filter((entry) => entry.extraction?.status === "succeeded").length,
    extractionUnsupportedCount: documents.filter((entry) => entry.extraction?.status === "unsupported").length,
    folderCount,
    folderPatternCount: folderPatterns.length,
    lowConfidenceCount: documents.filter((entry) => entry.confidenceScore < DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD).length,
    mixedFolderCount: folderPatterns.filter((pattern) => pattern.suggestedAction === "sort_each_file").length,
    moveSuggestionCount: documents.filter((entry) => entry.sortPlan.action === "move_to_standard_folder").length,
    outsideStandardFolderCount: documents.filter((entry) => entry.outsideStandardFolders).length,
    pinMentionCount: documents.filter((entry) => entry.signals.pinRefs.length > 0).length,
    skippedCount,
    unknownDocumentCount: documents.filter((entry) => entry.documentType === "unknown").length
  };
}

/**
 * Builds folder-level trends from mapped document rows.
 *
 * A pattern is reported only after the scan sees repeated files in the same folder. The
 * result helps an engineer pick the next folder to sort, but it never replaces the
 * individual file rows or claims the folder has been reviewed.
 */
function buildProjectDocumentFolderPatterns(documents: ProjectDocumentMapEntry[]): ProjectDocumentFolderPattern[] {
  const documentsByFolder = new Map<string, ProjectDocumentMapEntry[]>();

  for (const documentEntry of documents) {
    const folderDocuments = documentsByFolder.get(documentEntry.parentFolder) ?? [];
    folderDocuments.push(documentEntry);
    documentsByFolder.set(documentEntry.parentFolder, folderDocuments);
  }

  return Array.from(documentsByFolder.entries())
    .filter(([, folderDocuments]) => folderDocuments.length >= DOCUMENT_MAP_FOLDER_PATTERN_MIN_FILES)
    .map(([folderPath, folderDocuments]) => buildProjectDocumentFolderPattern(folderPath, folderDocuments))
    .sort(compareProjectDocumentFolderPatterns)
    .slice(0, DOCUMENT_MAP_MAX_FOLDER_PATTERNS);
}

/** Builds one folder-level trend record from the documents that share a parent folder. */
function buildProjectDocumentFolderPattern(folderPath: string, documents: ProjectDocumentMapEntry[]): ProjectDocumentFolderPattern {
  const typeCounts = countProjectDocumentTypes(documents);
  const dominantType = typeCounts[0] ?? null;
  const folderNameTypes = inferProjectDocumentTypesFromFolderPath(folderPath);
  const categoryCounts = countProjectDocumentSuggestedCategories(documents);
  const dominantCategory = categoryCounts[0] ?? null;
  const unknownDocumentCount = documents.filter((entry) => entry.documentType === "unknown").length;
  const moveSuggestionCount = documents.filter((entry) => entry.sortPlan.action === "move_to_standard_folder").length;
  const currentCategory = readFolderCurrentCategory(documents);
  const fileCount = documents.length;
  const dominantTypeShare = dominantType ? dominantType.count / fileCount : 0;
  const dominantCategoryShare = dominantCategory ? dominantCategory.count / fileCount : 0;
  const dominantDocumentType =
    dominantType && dominantTypeShare >= DOCUMENT_MAP_FOLDER_DOMINANT_SHARE
      ? dominantType.documentType
      : folderNameTypes.find((type) => type !== "unknown") ?? null;
  const suggestedCategory =
    dominantCategory && dominantCategoryShare >= DOCUMENT_MAP_FOLDER_DOMINANT_SHARE
      ? dominantCategory.category
      : dominantDocumentType
        ? suggestedCategoryForDocumentType(dominantDocumentType)
        : null;
  const suggestedFolder = suggestedCategory
    ? PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === suggestedCategory) ?? null
    : null;
  const outsideStandardFolders = documents.some((entry) => entry.outsideStandardFolders);
  const suggestedAction = chooseProjectDocumentFolderPatternAction({
    categoryCount: categoryCounts.length,
    currentCategory,
    fileCount,
    moveSuggestionCount,
    outsideStandardFolders,
    suggestedCategory,
    unknownDocumentCount
  });
  const confidenceScore = scoreProjectDocumentFolderPattern({
    documents,
    dominantCategoryShare,
    dominantDocumentType,
    dominantTypeShare,
    folderNameTypes
  });

  return {
    confidenceScore,
    currentCategory,
    dominantDocumentType,
    dominantTypeCount: dominantType?.count ?? 0,
    exampleFilenames: documents
      .slice()
      .sort(compareProjectDocumentMapEntries)
      .slice(0, 3)
      .map((entry) => entry.filename),
    fileCount,
    folderPath,
    id: `folder-pattern-${folderPath.replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase() || "project-root"}`,
    moveSuggestionCount,
    outsideStandardFolders,
    reason: buildProjectDocumentFolderPatternReason({
      dominantDocumentType,
      fileCount,
      folderNameTypes,
      suggestedAction,
      suggestedFolderLabel: suggestedFolder?.label ?? null,
      unknownDocumentCount
    }),
    signals: mergeProjectDocumentSignals(documents.map((entry) => entry.signals)),
    suggestedAction,
    suggestedCategory,
    suggestedFolderLabel: suggestedFolder?.label ?? null,
    typeCounts,
    unknownDocumentCount
  };
}

/** Counts document families inside one folder trend, sorted for deterministic display. */
function countProjectDocumentTypes(documents: ProjectDocumentMapEntry[]): ProjectDocumentTypeCount[] {
  const counts = new Map<ProjectDocumentType, number>();
  for (const documentEntry of documents) {
    counts.set(documentEntry.documentType, (counts.get(documentEntry.documentType) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([documentType, count]) => ({ count, documentType }))
    .sort((left, right) => right.count - left.count || left.documentType.localeCompare(right.documentType));
}

/** Counts suggested destination categories inside one folder trend. */
function countProjectDocumentSuggestedCategories(documents: ProjectDocumentMapEntry[]): Array<{ category: ProjectFolderCategory; count: number }> {
  const counts = new Map<ProjectFolderCategory, number>();
  for (const documentEntry of documents) {
    if (!documentEntry.suggestedCategory) {
      continue;
    }
    counts.set(documentEntry.suggestedCategory, (counts.get(documentEntry.suggestedCategory) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

/** Reads the current standard category for a folder group only when every file agrees. */
function readFolderCurrentCategory(documents: ProjectDocumentMapEntry[]): ProjectFolderCategory | null {
  const categories = new Set(documents.map((entry) => entry.currentCategory).filter((category): category is ProjectFolderCategory => Boolean(category)));
  return categories.size === 1 ? Array.from(categories)[0] ?? null : null;
}

/**
 * Infers document families from the folder name alone.
 *
 * These hints only affect the folder trend row. Individual file classification still
 * comes from each file's own path, extension, and readable text snippet.
 */
function inferProjectDocumentTypesFromFolderPath(folderPath: string): ProjectDocumentType[] {
  const normalized = folderPath.toLowerCase().replace(/[_-]+/gu, " ");
  const types: ProjectDocumentType[] = [];

  if (/\b(test|tests|atp|checkout|verification|verify)\b/u.test(normalized)) types.push("test_procedure");
  if (/\b(pinout|pin map|pin maps|wire list|wire lists|wiring)\b/u.test(normalized)) types.push("pinout");
  if (/\b(cable|cables|harness|harnesses)\b/u.test(normalized)) types.push("cable_doc");
  if (/\b(fixture|fixtures|jig|jigs|adapter|adapters)\b/u.test(normalized)) types.push("fixture_doc");
  if (/\b(requirement|requirements|spec|specs|interface control|icd)\b/u.test(normalized)) types.push("requirements");
  if (/\b(schematic|schematics|pcb|board|boards|altium|kicad)\b/u.test(normalized)) types.push("schematic");
  if (/\b(drawing|drawings|fab|fabrication|mechanical)\b/u.test(normalized)) types.push("drawing");
  if (/\b(datasheet|datasheets|data sheet|app note|application note)\b/u.test(normalized)) types.push("datasheet");
  if (/\b(parts list|part list|bom|boms)\b/u.test(normalized)) types.push("parts_list");
  if (/\b(model|models|cad|step|stp|solidworks|3d)\b/u.test(normalized)) types.push("cad_model");
  if (/\b(review|reviews|redline|redlines|note|notes)\b/u.test(normalized)) types.push("review_note");

  return Array.from(new Set(types));
}

/** Selects a safe folder-level next step without creating any filesystem side effect. */
function chooseProjectDocumentFolderPatternAction(input: {
  categoryCount: number;
  currentCategory: ProjectFolderCategory | null;
  fileCount: number;
  moveSuggestionCount: number;
  outsideStandardFolders: boolean;
  suggestedCategory: ProjectFolderCategory | null;
  unknownDocumentCount: number;
}): ProjectDocumentFolderPatternAction {
  if (input.unknownDocumentCount === input.fileCount) {
    return "open_folder";
  }

  if (input.categoryCount > 1) {
    return "sort_each_file";
  }

  if (input.outsideStandardFolders && input.suggestedCategory && input.moveSuggestionCount > 0) {
    return "use_file_copy_buttons";
  }

  if (!input.outsideStandardFolders && input.currentCategory && input.suggestedCategory === input.currentCategory && input.unknownDocumentCount === 0) {
    return "leave_folder";
  }

  if (input.unknownDocumentCount > 0) {
    return "open_folder";
  }

  return "sort_each_file";
}

/** Scores a folder trend from repeated file classifications, destination agreement, and folder name clues. */
function scoreProjectDocumentFolderPattern(input: {
  documents: ProjectDocumentMapEntry[];
  dominantCategoryShare: number;
  dominantDocumentType: ProjectDocumentType | null;
  dominantTypeShare: number;
  folderNameTypes: ProjectDocumentType[];
}): number {
  const averageFileScore =
    input.documents.reduce((total, entry) => total + entry.confidenceScore, 0) / Math.max(input.documents.length, 1);
  const folderNameBoost = input.dominantDocumentType && input.folderNameTypes.includes(input.dominantDocumentType) ? 0.08 : 0;
  const score = averageFileScore * 0.45 + input.dominantTypeShare * 0.35 + input.dominantCategoryShare * 0.2 + folderNameBoost;

  return Math.max(0.1, Math.min(0.99, Number(score.toFixed(2))));
}

/** Builds plain-language folder trend copy for engineers cleaning a messy project tree. */
function buildProjectDocumentFolderPatternReason(input: {
  dominantDocumentType: ProjectDocumentType | null;
  fileCount: number;
  folderNameTypes: ProjectDocumentType[];
  suggestedAction: ProjectDocumentFolderPatternAction;
  suggestedFolderLabel: string | null;
  unknownDocumentCount: number;
}): string {
  if (input.suggestedAction === "open_folder") {
    return input.unknownDocumentCount === input.fileCount
      ? "Most files in this folder need clearer names before the scan can suggest a place."
      : "This folder has a few unclear files. Open it before copying anything.";
  }

  if (input.suggestedAction === "sort_each_file") {
    return "This folder mixes more than one likely destination. Use the file rows below.";
  }

  if (input.suggestedAction === "use_file_copy_buttons") {
    const source = input.folderNameTypes.length > 0 ? "Folder name and file names" : "File names";
    const target = input.suggestedFolderLabel ?? "a standard folder";
    return `${source} point most of these files toward ${target}.`;
  }

  if (input.dominantDocumentType) {
    return `${input.fileCount} files in this folder look like ${formatProjectDocumentTypeForPlan(input.dominantDocumentType)}.`;
  }

  return "Files in this folder already line up with the current folder.";
}

/** Combines folder-level engineering clues while keeping each list small. */
function mergeProjectDocumentSignals(signalsList: ProjectDocumentSignals[]): ProjectDocumentSignals {
  return {
    cableKeys: mergeSignalValues(signalsList.flatMap((signals) => signals.cableKeys)),
    connectorRefs: mergeSignalValues(signalsList.flatMap((signals) => signals.connectorRefs)),
    fixtureKeys: mergeSignalValues(signalsList.flatMap((signals) => signals.fixtureKeys)),
    pinRefs: mergeSignalValues(signalsList.flatMap((signals) => signals.pinRefs)),
    revisionLabels: mergeSignalValues(signalsList.flatMap((signals) => signals.revisionLabels)),
    signalNames: mergeSignalValues(signalsList.flatMap((signals) => signals.signalNames))
  };
}

/** Deduplicates signal values with a small display cap. */
function mergeSignalValues(values: string[]): string[] {
  return sortedStrings(values).slice(0, 8);
}

/** Sorts folder patterns so the most useful cleanup hints appear first. */
function compareProjectDocumentFolderPatterns(left: ProjectDocumentFolderPattern, right: ProjectDocumentFolderPattern): number {
  const actionCompare = getProjectDocumentFolderPatternRank(left.suggestedAction) - getProjectDocumentFolderPatternRank(right.suggestedAction);
  if (actionCompare !== 0) {
    return actionCompare;
  }

  if (left.moveSuggestionCount !== right.moveSuggestionCount) {
    return right.moveSuggestionCount - left.moveSuggestionCount;
  }

  if (left.outsideStandardFolders !== right.outsideStandardFolders) {
    return left.outsideStandardFolders ? -1 : 1;
  }

  if (left.fileCount !== right.fileCount) {
    return right.fileCount - left.fileCount;
  }

  return left.folderPath.localeCompare(right.folderPath, undefined, { sensitivity: "base" });
}

/** Returns the display priority for folder trend actions. */
function getProjectDocumentFolderPatternRank(action: ProjectDocumentFolderPatternAction): number {
  return {
    use_file_copy_buttons: 0,
    sort_each_file: 1,
    open_folder: 2,
    leave_folder: 3
  }[action];
}

/**
 * Reads a small UTF-8 preview from text-like files. Binary, unknown, and oversized files
 * are classified from their path only, which keeps the scan cheap and avoids bad decode
 * guesses on PDFs, archives, and CAD binaries.
 */
async function readDocumentTextPreview(absolutePath: string, sizeBytes: number): Promise<string> {
  const extension = path.extname(absolutePath).toLowerCase();
  if (!DOCUMENT_MAP_TEXT_EXTENSIONS.has(extension) || sizeBytes > DOCUMENT_MAP_TEXT_SCAN_BYTES) {
    return "";
  }

  try {
    return normalizeMetadataText(await readFile(absolutePath, "utf8")) ?? "";
  } catch {
    return "";
  }
}

/**
 * Classifies one project document using filename, folder, extension, text preview, and
 * extracted engineering clues. Scores are deliberately rough; the UI shows them as scan
 * confidence, not review status.
 */
function classifyProjectDocument(
  relativePath: string,
  filename: string,
  textPreview: string,
  signals: ProjectDocumentSignals
): ProjectDocumentClassification {
  const extension = path.extname(filename).toLowerCase();
  const pathText = `${relativePath} ${filename}`.toLowerCase();
  const contentText = textPreview.toLowerCase();
  const combinedText = `${pathText}\n${contentText}`;
  const candidates: DocumentTypeCandidate[] = [];
  const spreadsheetLike = extension === ".csv" || extension === ".xlsx";
  const partsListWording = hasAnyPhrase(combinedText, ["bom", "part list", "parts list", "parts-list", "bill of materials"]);

  addDocumentTypeCandidate(candidates, partsListWording, "parts_list", 0.94, "Parts-list wording found.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["datasheet", "data sheet", "app note", "application note"]), "datasheet", 0.92, "Datasheet or app-note wording.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["pinout", "pin map", "pin-map"]) || (signals.connectorRefs.length > 0 && /\bpin\s*\d+/iu.test(combinedText)), "pinout", 0.9, "Connector and pin wording found.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["cable", "harness", "wire list", "wirelist"]) || signals.cableKeys.length > 0, "cable_doc", 0.88, "Cable or harness wording found.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["fixture", "test fixture", "jig", "bench adapter"]) || signals.fixtureKeys.length > 0, "fixture_doc", 0.86, "Fixture, jig, or adapter wording found.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["test procedure", "verification procedure", "acceptance test", "atp", "test plan"]), "test_procedure", 0.93, "Test procedure wording found.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["requirement", "requirements", "interface control", "icd", "shall "]), "requirements", 0.84, "Requirements or interface-control wording found.");
  addDocumentTypeCandidate(candidates, isSchematicLikeExtension(extension) || hasAnyPhrase(combinedText, ["schematic", "pcb", "board file", "altium", "kicad"]), "schematic", 0.83, "Schematic or board-file wording found.");
  addDocumentTypeCandidate(candidates, hasAnyPhrase(combinedText, ["drawing", "fab", "fabrication", "assembly drawing", "mechanical drawing"]), "drawing", 0.8, "Drawing or fabrication wording found.");
  addDocumentTypeCandidate(candidates, isCadModelExtension(extension), "cad_model", 0.96, "CAD model extension.");
  addDocumentTypeCandidate(candidates, /^review-.+\.md$/iu.test(filename) || hasAnyPhrase(combinedText, ["red note", "requested correction"]), "review_note", 0.78, "Review-note wording found.");
  addDocumentTypeCandidate(candidates, isArchiveExtension(extension), "archive", 0.76, "Archive extension.");
  addDocumentTypeCandidate(candidates, spreadsheetLike, "parts_list", 0.64, "Spreadsheet file; confirm what it contains.");

  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  if (!selected) {
    return {
      documentType: "unknown",
      reason: "No strong document clue found.",
      score: 0.35,
      suggestedCategory: null
    };
  }

  return {
    documentType: selected.documentType,
    reason: selected.reason,
    score: selected.score,
    suggestedCategory: suggestedCategoryForDocumentType(selected.documentType)
  };
}

/**
 * Adds a document-type candidate only when its predicate matched.
 */
function addDocumentTypeCandidate(
  candidates: DocumentTypeCandidate[],
  condition: boolean,
  documentType: ProjectDocumentType,
  score: number,
  reason: string
): void {
  if (condition) {
    candidates.push({ documentType, reason, score });
  }
}

/**
 * Extracts connector, cable, fixture, revision, and signal clues from a bounded text
 * body. Each list is capped so noisy files cannot produce huge API payloads.
 */
function extractProjectDocumentSignals(text: string): ProjectDocumentSignals {
  return {
    cableKeys: collectDocumentMatches(text, /\b(?:CAB|CBL|CABLE|HARNESS)[-_][A-Z0-9][A-Z0-9_-]{1,60}\b/giu, normalizeCableDocumentKey),
    connectorRefs: collectDocumentMatches(text, /\bJ\d{1,4}[A-Z]?\b/giu, uppercaseDocumentSignal),
    fixtureKeys: collectDocumentMatches(text, /\b(?:TFX|FIXTURE|JIG|PTA|PCA|ICD)[-_][A-Z0-9][A-Z0-9_-]{0,60}\b/giu, uppercaseDocumentSignal),
    pinRefs: collectDocumentMatches(text, /(?:\bpin\s*[:#-]?\s*([A-Z]?\d{1,4}[A-Z]?)\b|\bJ\d{1,4}[A-Z]?\s*[,;:\t ]+\s*(?:pin\s*)?([A-Z]?\d{1,4}[A-Z]?)\b)/giu, normalizePinRef),
    revisionLabels: collectDocumentMatches(text, /\b(?:Revision\s*[:#-]?\s*(?:Rev\.?\s*)?[A-Z0-9]+(?:\.[A-Z0-9]+)?|Rev\.?(?:\s+|[:#-]\s*)[A-Z0-9]+(?:\.[A-Z0-9]+)?|R\d+(?:\.\d+)?)\b/giu, normalizeRevisionLabel),
    signalNames: collectDocumentMatches(text, /(?:^|[^A-Z0-9_+-])([A-Z][A-Z0-9]{1,24}(?:_[A-Z0-9+-]{1,24})+)(?![A-Z0-9_+-])/gu, normalizeDocumentWhitespace)
  };
}

/** Builds a tolerant query needle for document where-used searches. */
function buildProjectDocumentSearchNeedle(query: string): ProjectDocumentSearchNeedle | null {
  const rawQuery = normalizeDocumentWhitespace(query);
  if (!rawQuery) {
    return null;
  }

  const signals = extractProjectDocumentSignals(rawQuery);
  const signalTokens = new Set(
    Object.values(signals)
      .flat()
      .map((value) => value.toLowerCase())
  );
  const tokens = rawQuery
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !DOCUMENT_SEARCH_STOP_WORDS.has(token))
    .filter((token) => !signalTokens.has(token));

  return {
    documentTypes: inferProjectDocumentTypesFromSearch(rawQuery),
    rawQuery,
    signals,
    tokens,
  };
}

/** Infers requested document families from plain query wording. */
function inferProjectDocumentTypesFromSearch(query: string): ProjectDocumentType[] {
  const normalized = query.toLowerCase();
  const types: ProjectDocumentType[] = [];

  if (/\b(test|procedure|checkout|bring[-\s]?up)\b/u.test(normalized)) types.push("test_procedure");
  if (/\b(pinout|pin\s*map|wire\s*list|wiring)\b/u.test(normalized)) types.push("pinout");
  if (/\b(cable|harness|adapter)\b/u.test(normalized)) types.push("cable_doc");
  if (/\b(fixture|jig|test\s*box)\b/u.test(normalized)) types.push("fixture_doc");
  if (/\b(requirement|requirements|spec)\b/u.test(normalized)) types.push("requirements");
  if (/\b(schematic|board|pcb)\b/u.test(normalized)) types.push("schematic");
  if (/\b(drawing|print)\b/u.test(normalized)) types.push("drawing");
  if (/\b(datasheet|data\s*sheet|app\s*note)\b/u.test(normalized)) types.push("datasheet");
  if (/\b(parts?\s*list|bom)\b/u.test(normalized)) types.push("parts_list");
  if (/\b(model|step|stp|solidworks|3d)\b/u.test(normalized)) types.push("cad_model");
  if (/\b(review|redline|note)\b/u.test(normalized)) types.push("review_note");

  return Array.from(new Set(types));
}

/** Returns match labels when one document-map row satisfies the normalized query. */
function matchProjectDocumentToSearchNeedle(entry: ProjectDocumentMapEntry, needle: ProjectDocumentSearchNeedle): string[] {
  const labels: string[] = [];
  const corpus = buildProjectDocumentSearchCorpus(entry);
  const querySignals = needle.signals;

  const connectorMatches = matchedSignalValues(querySignals.connectorRefs, entry.signals.connectorRefs);
  const pinMatches = matchedSignalValues(querySignals.pinRefs, entry.signals.pinRefs);
  const cableMatches = matchedSignalValues(querySignals.cableKeys, entry.signals.cableKeys);
  const fixtureMatches = matchedSignalValues(querySignals.fixtureKeys, entry.signals.fixtureKeys);
  const revisionMatches = matchedSignalValues(querySignals.revisionLabels, entry.signals.revisionLabels);
  const signalMatches = matchedSignalValues(querySignals.signalNames, entry.signals.signalNames);

  if (querySignals.connectorRefs.length > 0 && connectorMatches.length === 0) return [];
  if (querySignals.pinRefs.length > 0 && pinMatches.length === 0) return [];
  if (querySignals.cableKeys.length > 0 && cableMatches.length === 0) return [];
  if (querySignals.fixtureKeys.length > 0 && fixtureMatches.length === 0) return [];
  if (querySignals.revisionLabels.length > 0 && revisionMatches.length === 0) return [];
  if (querySignals.signalNames.length > 0 && signalMatches.length === 0) return [];

  if (needle.documentTypes.length > 0 && !needle.documentTypes.includes(entry.documentType)) {
    return [];
  }

  const missingToken = needle.tokens.find((token) => !corpus.includes(token));
  if (missingToken) {
    return [];
  }

  if (connectorMatches.length > 0) labels.push(`Connector: ${connectorMatches.join(", ")}`);
  if (pinMatches.length > 0) labels.push(`Pin: ${pinMatches.join(", ")}`);
  if (cableMatches.length > 0) labels.push(`Cable: ${cableMatches.join(", ")}`);
  if (fixtureMatches.length > 0) labels.push(`Fixture: ${fixtureMatches.join(", ")}`);
  if (revisionMatches.length > 0) labels.push(`Revision: ${revisionMatches.join(", ")}`);
  if (signalMatches.length > 0) labels.push(`Signal: ${signalMatches.join(", ")}`);
  if (needle.documentTypes.includes(entry.documentType)) labels.push(`Type: ${formatProjectDocumentTypeLabel(entry.documentType)}`);

  if (labels.length === 0 && corpus.includes(needle.rawQuery.toLowerCase())) {
    labels.push("File or folder");
  }

  if (labels.length === 0 && needle.tokens.length > 0) {
    labels.push("File or folder");
  }

  return labels;
}

/** Finds page, sheet, slide, or paragraph labels containing all requested clues. */
function matchExtractionSourceLocations(
  segments: Array<ProjectDocumentExtractionSourceLocation & { text: string }>,
  needle: ProjectDocumentSearchNeedle
): string[] {
  const queryValues = [
    ...needle.signals.connectorRefs,
    ...needle.signals.pinRefs,
    ...needle.signals.cableKeys,
    ...needle.signals.fixtureKeys,
    ...needle.signals.revisionLabels,
    ...needle.signals.signalNames,
    ...needle.tokens
  ].map((value) => value.toLowerCase());

  if (queryValues.length === 0) {
    return [];
  }

  return segments
    .filter((segment) => {
      const text = segment.text.toLowerCase();
      return queryValues.every((value) => text.includes(value));
    })
    .slice(0, 3)
    .map((segment) => `Source: ${segment.label}`);
}

/** Builds lowercase searchable text from a document-map row's stored fields. */
function buildProjectDocumentSearchCorpus(entry: ProjectDocumentMapEntry): string {
  return [
    entry.filename,
    entry.relativePath,
    entry.parentFolder,
    entry.reason,
    entry.documentType,
    formatProjectDocumentTypeLabel(entry.documentType),
    entry.sortPlan.reason,
    entry.sortPlan.targetRelativePath ?? "",
    ...entry.signals.connectorRefs,
    ...entry.signals.pinRefs,
    ...entry.signals.cableKeys,
    ...entry.signals.fixtureKeys,
    ...entry.signals.revisionLabels,
    ...entry.signals.signalNames
  ].join(" ").toLowerCase();
}

/** Returns query clue values found in one document-map signal list. */
function matchedSignalValues(queryValues: string[], entryValues: string[]): string[] {
  const normalizedEntryValues = entryValues.map((value) => value.toLowerCase());
  return queryValues.filter((queryValue) => normalizedEntryValues.includes(queryValue.toLowerCase()));
}

/** Sorts document hits for deterministic global where-used rendering. */
function compareWhereUsedDocumentHits(left: WhereUsedDocumentHitRecord, right: WhereUsedDocumentHitRecord): number {
  if (left.document.needsAttention !== right.document.needsAttention) {
    return left.document.needsAttention ? -1 : 1;
  }

  const projectCompare = left.project.projectKey.localeCompare(right.project.projectKey, undefined, { sensitivity: "base" });
  if (projectCompare !== 0) {
    return projectCompare;
  }

  return left.document.relativePath.localeCompare(right.document.relativePath, undefined, { sensitivity: "base" });
}

/** Formats document types for where-used match labels. */
function formatProjectDocumentTypeLabel(documentType: ProjectDocumentType): string {
  return {
    archive: "Archive",
    cad_model: "CAD model",
    cable_doc: "Cable or harness doc",
    datasheet: "Datasheet or app note",
    drawing: "Drawing",
    fixture_doc: "Fixture doc",
    parts_list: "Parts list",
    pinout: "Connector pinout",
    requirements: "Requirements",
    review_note: "Review note",
    schematic: "Schematic or board file",
    test_procedure: "Test procedure",
    unknown: "Needs sorting"
  }[documentType];
}

/**
 * Collects unique regex matches with a small result cap for stable scan payloads.
 * Patterns may expose a first capture group when they need a custom boundary.
 */
function collectDocumentMatches(text: string, pattern: RegExp, normalize: (value: string) => string): string[] {
  const matches = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const capturedValue = match.slice(1).find((value) => typeof value === "string" && value.length > 0);
    const value = normalize(capturedValue ?? match[0] ?? "");
    if (value) {
      matches.add(value);
    }
    if (matches.size >= 12) {
      break;
    }
  }

  return Array.from(matches);
}

/** Normalizes a document clue to uppercase for connector, cable, and fixture ids. */
function uppercaseDocumentSignal(value: string): string {
  return normalizeDocumentWhitespace(value).toUpperCase();
}

/** Normalizes pin clues without claiming they are valid for a specific connector. */
function normalizePinRef(value: string): string {
  return normalizeDocumentWhitespace(value).toUpperCase();
}

/** Normalizes a cable-like clue so document suffixes do not become part of the assembly id. */
function normalizeCableDocumentKey(value: string): string {
  return uppercaseDocumentSignal(value).replace(/[-_](?:PINOUT|PIN-MAP|PINMAP|WIRE-LIST|WIRELIST)$/u, "");
}

/** Collapses whitespace in document-scan clues. */
function normalizeDocumentWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Normalizes revision clues so filenames like "rev-d.md" and text like "Revision: Rev D" display as "Rev D". */
function normalizeRevisionLabel(value: string): string {
  const normalized = normalizeDocumentWhitespace(value).replace(/\.(?:csv|docx?|md|pdf|txt|xlsx?)$/iu, "");
  const revisionPrefixMatch = /^Revision\s*[:#-]?\s*(.+)$/iu.exec(normalized);
  const label = revisionPrefixMatch?.[1] ? normalizeDocumentWhitespace(revisionPrefixMatch[1]) : normalized;
  const revMatch = /^Rev\.?(?:\s+|[:#_-]\s*)([A-Z0-9]+(?:\.[A-Z0-9]+)?)$/iu.exec(label);
  if (revMatch?.[1]) {
    return `Rev ${revMatch[1].toUpperCase()}`;
  }

  const rMatch = /^R(\d+(?:\.\d+)?)$/iu.exec(label);
  if (rMatch?.[1]) {
    return `R${rMatch[1]}`;
  }

  if (revisionPrefixMatch?.[1] && /^[A-Z0-9]+(?:\.[A-Z0-9]+)?$/iu.test(label)) {
    return `Rev ${label.toUpperCase()}`;
  }

  return label;
}

/** Returns true when a body of text contains any exact lower-case phrase. */
function hasAnyPhrase(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

/** Returns true for common schematic and PCB source extensions. */
function isSchematicLikeExtension(extension: string): boolean {
  return [".brd", ".dsn", ".kicad_pcb", ".kicad_sch", ".pcb", ".pcbdoc", ".sch", ".schdoc"].includes(extension);
}

/** Returns true for common mechanical or viewer CAD extensions. */
function isCadModelExtension(extension: string): boolean {
  return [".3dm", ".glb", ".gltf", ".iges", ".igs", ".obj", ".sldasm", ".sldprt", ".step", ".stl", ".stp"].includes(extension);
}

/** Returns true for common archive extensions. */
function isArchiveExtension(extension: string): boolean {
  return [".7z", ".gz", ".rar", ".tar", ".tgz", ".zip"].includes(extension);
}

/**
 * Builds the non-mutating cleanup plan shown beside a document-map row.
 *
 * The plan intentionally stops short of file operations. It gives engineers a stable
 * destination path and a plain reason so a later copy/move action can be explicit.
 */
function buildProjectDocumentSortPlan(input: ProjectDocumentSortPlanInput): ProjectDocumentSortPlan {
  const suggestedCategory = input.classification.suggestedCategory;
  const targetFolder = suggestedCategory ? PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === suggestedCategory) ?? null : null;
  const targetRelativePath = targetFolder
    ? buildProjectDocumentTargetRelativePath(targetFolder, input.filename, input.classification.documentType, input.signals)
    : null;

  if (input.classification.documentType === "unknown") {
    return {
      action: "review_unknown",
      reason: "Open this file or rename it with a clearer document type before sorting.",
      sourceRelativePath: input.relativePath,
      targetCategory: null,
      targetFolderLabel: null,
      targetRelativePath: null
    };
  }

  if (!suggestedCategory || !targetFolder || !targetRelativePath) {
    return {
      action: "choose_destination",
      reason: "The scan found clues, but no standard folder is obvious yet.",
      sourceRelativePath: input.relativePath,
      targetCategory: suggestedCategory,
      targetFolderLabel: targetFolder?.label ?? null,
      targetRelativePath
    };
  }

  if (input.currentCategory === suggestedCategory && input.classification.score >= DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD) {
    return {
      action: "leave_in_place",
      reason: "This file is already in the suggested standard folder.",
      sourceRelativePath: input.relativePath,
      targetCategory: suggestedCategory,
      targetFolderLabel: targetFolder.label,
      targetRelativePath: input.relativePath
    };
  }

  if (input.currentCategory === null && input.classification.score >= DOCUMENT_MAP_LOW_CONFIDENCE_THRESHOLD) {
    return {
      action: "move_to_standard_folder",
      reason: `This looks like ${formatProjectDocumentTypeForPlan(input.classification.documentType).toLowerCase()} outside the standard folders.`,
      sourceRelativePath: input.relativePath,
      targetCategory: suggestedCategory,
      targetFolderLabel: targetFolder.label,
      targetRelativePath
    };
  }

  return {
    action: "choose_destination",
    reason: "This file has a suggested folder, but a person should check the match first.",
    sourceRelativePath: input.relativePath,
    targetCategory: suggestedCategory,
    targetFolderLabel: targetFolder.label,
    targetRelativePath
  };
}

/** Builds a deterministic relative destination path for a cleanup suggestion. */
function buildProjectDocumentTargetRelativePath(
  folder: ProjectFolderDefinition,
  filename: string,
  documentType: ProjectDocumentType,
  signals: ProjectDocumentSignals
): string | null {
  const safeFilename = sanitizeUploadFilename(filename);
  if (!safeFilename) {
    return null;
  }

  const pathSegments = [folder.folderName];
  const hardwareKey =
    folder.category === "hardware" && (documentType === "cable_doc" || documentType === "pinout")
      ? signals.cableKeys[0] ?? null
      : folder.category === "hardware" && documentType === "fixture_doc"
        ? signals.fixtureKeys[0] ?? null
        : null;
  const safeHardwareSegment = hardwareKey ? sanitizeProjectDocumentPathSegment(hardwareKey) : null;
  if (safeHardwareSegment) {
    pathSegments.push(safeHardwareSegment);
  }

  pathSegments.push(safeFilename);
  return normalizeRelativePath(path.posix.join(...pathSegments));
}

/** Sanitizes a generated path segment used only for sort-plan suggestions. */
function sanitizeProjectDocumentPathSegment(value: string): string | null {
  const safeValue = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-.]+/u, "")
    .replace(/[-.]+$/u, "");
  return safeValue.length > 0 ? safeValue : null;
}

/** Formats a document type for API sort-plan reasons. */
function formatProjectDocumentTypeForPlan(documentType: ProjectDocumentType): string {
  return {
    archive: "an archive",
    cad_model: "a CAD model",
    cable_doc: "a cable or harness document",
    datasheet: "a datasheet or app note",
    drawing: "a drawing",
    fixture_doc: "a fixture document",
    parts_list: "a parts list",
    pinout: "a connector pinout",
    requirements: "a requirements document",
    review_note: "a review note",
    schematic: "a schematic or board file",
    test_procedure: "a test procedure",
    unknown: "an unknown file"
  }[documentType];
}

/** Maps a scan type to the standard project folder that most likely fits. */
function suggestedCategoryForDocumentType(documentType: ProjectDocumentType): ProjectFolderCategory | null {
  if (documentType === "parts_list") {
    return "parts_list";
  }
  if (documentType === "datasheet") {
    return "datasheets";
  }
  if (documentType === "cad_model") {
    return "models";
  }
  if (documentType === "cable_doc" || documentType === "drawing" || documentType === "fixture_doc" || documentType === "pinout" || documentType === "schematic") {
    return "hardware";
  }
  if (documentType === "requirements" || documentType === "review_note" || documentType === "test_procedure") {
    return "notes";
  }
  return null;
}

/** Reads the standard folder category from a relative path's first segment. */
function readProjectCategoryFromRelativePath(relativePath: string): ProjectFolderCategory | null {
  const firstSegment = relativePath.split("/")[0] ?? "";
  const match = PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.folderName.toLowerCase() === firstSegment.toLowerCase());
  return match?.category ?? null;
}

/** Returns a normalized slash-separated relative path for API responses. */
function normalizeRelativePath(value: string): string {
  return value.replace(/\\/gu, "/") || ".";
}

/** Returns true when a filesystem entry should be hidden from document-map scans. */
function shouldSkipDocumentMapEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith(".") || lower === "thumbs.db" || lower === ".ds_store";
}

/** Sorts document-map entries so attention rows appear first, then folders and names. */
function compareProjectDocumentMapEntries(left: ProjectDocumentMapEntry, right: ProjectDocumentMapEntry): number {
  if (left.needsAttention !== right.needsAttention) {
    return left.needsAttention ? -1 : 1;
  }
  if (left.outsideStandardFolders !== right.outsideStandardFolders) {
    return left.outsideStandardFolders ? -1 : 1;
  }
  const typeCompare = left.documentType.localeCompare(right.documentType);
  if (typeCompare !== 0) {
    return typeCompare;
  }
  return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: "base" });
}

/**
 * Reads text-like parts-list source files and maps custom design part numbers to
 * filenames where they were observed. Binary or oversized files are skipped instead of
 * guessed.
 */
async function readCustomHardwareReferencesFromPartsList(partsListFolderPath: string, recognizedPrefixes: string[]): Promise<Map<string, string[]>> {
  const references = new Map<string, string[]>();
  const entries = await readdir(partsListFolderPath, { withFileTypes: true });
  const visibleFiles = entries.filter((entry) => !entry.name.startsWith(".") && entry.isFile());

  for (const entry of visibleFiles) {
    const extension = path.extname(entry.name).toLowerCase();
    if (!PARTS_LIST_REFERENCE_EXTENSIONS.has(extension)) {
      continue;
    }

    const absolutePath = path.join(partsListFolderPath, entry.name);
    const info = await stat(absolutePath);
    if (info.size > MAX_PARTS_LIST_SCAN_BYTES) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    for (const partNumber of findCustomHardwarePartNumbers(content, recognizedPrefixes)) {
      const filenames = references.get(partNumber) ?? [];
      filenames.push(entry.name);
      references.set(partNumber, filenames);
    }
  }

  return references;
}

/**
 * Reads the first supported metadata file inside a custom design folder. If the file
 * has free-form notes but no structured labels, the whole trimmed body becomes `notes`.
 */
async function readCustomHardwareMetadata(folderPath: string, partNumber: string): Promise<CustomHardwareMetadataReadResult | null> {
  const prefix = partNumber.split("-")[0]?.toLowerCase();
  const filenames = prefix
    ? [...CUSTOM_HARDWARE_METADATA_FILENAMES, `${prefix}.json`, `${prefix}.md`, `${prefix.toUpperCase()}.md`]
    : [...CUSTOM_HARDWARE_METADATA_FILENAMES];

  for (const filename of filenames) {
    const filePath = path.join(folderPath, filename);
    const info = await safeStat(filePath);

    if (!info?.isFile()) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    const fields = filename.toLowerCase().endsWith(".json")
      ? parseCustomHardwareJsonMetadata(content)
      : parseCustomHardwareTextMetadata(content);

    return {
      ...fields,
      metadataSource: filename,
      modifiedAt: info.mtime.toISOString()
    };
  }

  return null;
}

/**
 * Parses a JSON metadata file. Unknown keys are ignored so a design folder can carry extra
 * team-local fields without breaking the API reader.
 */
function parseCustomHardwareJsonMetadata(content: string): CustomHardwareMetadataFields {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return emptyCustomHardwareMetadataFields();
    }

    return {
      attachedProject: readAliasedMetadataValue(parsed, ["attachedProject", "attached_project", "project", "projectAttached", "project_attached", "program", "usedOn", "used_on", "usedIn", "used_in"]),
      connectsTo: readAliasedMetadataValue(parsed, ["connectsTo", "connects_to", "connects", "connectedTo", "connected_to", "connector", "connectors", "interface", "interfaces", "dut", "unitUnderTest", "unit_under_test"]),
      notes: readAliasedMetadataValue(parsed, ["notes", "note", "description", "summary"]),
      tests: readAliasedMetadataValue(parsed, ["tests", "test", "testsFor", "tests_for", "testIntent", "test_intent", "validates", "validate", "verification", "purpose"])
    };
  } catch {
    return emptyCustomHardwareMetadataFields();
  }
}

/**
 * Parses Markdown or text metadata lines using labels such as `Connects to:` and
 * `Tests:`. The parser is intentionally small and deterministic so it can be audited.
 */
function parseCustomHardwareTextMetadata(content: string): CustomHardwareMetadataFields {
  const fields = emptyCustomHardwareMetadataFields();
  const normalizedContent = content.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  const lines = normalizedContent.split("\n");

  for (const line of lines) {
    const match = /^(?:[-*]\s*)?(connects?\s+to|connected\s+to|connects|connectors?|interfaces?|dut|unit\s+under\s+test|tests?|test\s+intent|what\s+it\s+tests|validates?|verification|purpose|attached\s+project|project\s+attached|project|program|used\s+on|used\s+in|notes?)\s*:\s*(.+)$/iu.exec(line.trim());
    if (!match) {
      continue;
    }

    const label = normalizeMetadataLabel(match[1] ?? "");
    const value = normalizeMetadataText(match[2] ?? "");
    if (!value) {
      continue;
    }

    if (label === "connects to" || label === "connected to" || label === "connects" || label === "connector" || label === "connectors" || label === "interface" || label === "interfaces" || label === "dut" || label === "unit under test") {
      fields.connectsTo = value;
    } else if (label === "test" || label === "tests" || label === "test intent" || label === "what it tests" || label === "validate" || label === "validates" || label === "verification" || label === "purpose") {
      fields.tests = value;
    } else if (label === "attached project" || label === "project attached" || label === "project" || label === "program" || label === "used on" || label === "used in") {
      fields.attachedProject = value;
    } else if (label === "note" || label === "notes") {
      fields.notes = value;
    }
  }

  if (!fields.connectsTo && !fields.tests && !fields.attachedProject && !fields.notes) {
    fields.notes = normalizeMetadataText(normalizedContent);
  }

  return fields;
}

/** Returns an empty metadata field set with every uncertain field represented as null. */
function emptyCustomHardwareMetadataFields(): CustomHardwareMetadataFields {
  return {
    attachedProject: null,
    connectsTo: null,
    notes: null,
    tests: null
  };
}

/** Reads the first nonblank string value from a record by a list of accepted field names. */
function readAliasedMetadataValue(record: Record<string, unknown>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = normalizeMetadataValue(record[alias]);
    if (value) {
      return value;
    }
  }

  return null;
}

/** Normalizes JSON metadata values without inventing text for non-string structures. */
function normalizeMetadataValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeMetadataText(value);
}

/** Normalizes text metadata and caps huge notes to keep response payloads bounded. */
function normalizeMetadataText(value: string): string | null {
  const normalized = value.replace(/\u0000/gu, "").replace(/[ \t]+\n/gu, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length > 1200 ? `${normalized.slice(0, 1197)}...` : normalized;
}

/** Normalizes metadata labels for compact switch logic. */
function normalizeMetadataLabel(value: string): string {
  return value.toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/** Checks whether an unknown JSON payload is a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the active prefix list from configured/default seeds plus real design folder
 * names. Folder discovery is intentionally limited to the `hardware/` directory.
 */
function resolveCustomHardwarePrefixes(folderNames: string[], seedPrefixes: string[]): string[] {
  const discoveredPrefixes = folderNames
    .map((folderName) => parseCustomHardwarePartNumberCandidate(folderName)?.prefix ?? null)
    .filter((prefix): prefix is string => Boolean(prefix));

  return sortedStrings([...seedPrefixes, ...discoveredPrefixes]);
}

/**
 * Parses a custom design part number candidate from a folder name. Accepted separators
 * are dash, dot, and underscore; all responses use the canonical dash form.
 */
function parseCustomHardwarePartNumberCandidate(value: string): { partNumber: string; prefix: string; suffix: string } | null {
  const match = CUSTOM_HARDWARE_PART_NUMBER_PATTERN.exec(value.trim());
  const prefix = normalizeCustomHardwarePrefix(match?.[1] ?? "");
  const suffix = match?.[2];

  return prefix && suffix ? { partNumber: `${prefix}-${suffix}`, prefix, suffix } : null;
}

/** Normalizes configured or discovered custom design prefixes to a bounded token. */
function normalizeCustomHardwarePrefix(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
  return normalized.length >= 2 && normalized.length <= 20 && /^[A-Z][A-Z0-9]*$/u.test(normalized) ? normalized : null;
}

/**
 * Returns every canonical custom design part number in a body of text. Dot and
 * underscore variants such as `PCA.1001` or `FIXTURE_7` normalize to dash form.
 */
function findCustomHardwarePartNumbers(content: string, recognizedPrefixes: string[]): string[] {
  const pattern = buildCustomHardwareReferencePattern(recognizedPrefixes);
  const matches = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    const prefix = match[1]?.toUpperCase();
    const suffix = match[2];
    if (prefix && suffix) {
      matches.add(`${prefix}-${suffix}`);
    }
  }

  return Array.from(matches);
}

/**
 * Canonicalizes custom design folder names. Folder reads are stricter than text
 * scanning because a folder named `<prefix>-<number>` is the durable hardware record.
 */
function canonicalizeCustomHardwarePartNumber(folderName: string, recognizedPrefixes: string[]): string | null {
  const candidate = parseCustomHardwarePartNumberCandidate(folderName);
  if (!candidate || !recognizedPrefixes.includes(candidate.prefix)) {
    return null;
  }

  return candidate.partNumber;
}

/** Sorts custom design records by numeric suffix, then by full part number. */
function compareCustomHardwareRecords(left: ProjectCustomHardwareRecord, right: ProjectCustomHardwareRecord): number {
  const leftNumber = Number(left.partNumber.replace(/^[A-Z0-9]+-/iu, ""));
  const rightNumber = Number(right.partNumber.replace(/^[A-Z0-9]+-/iu, ""));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.partNumber.localeCompare(right.partNumber);
}

/** Builds the text-scanning regex from the active custom-hardware prefixes. */
function buildCustomHardwareReferencePattern(recognizedPrefixes: string[]): RegExp {
  return new RegExp(`\\b(${recognizedPrefixes.map(escapeRegExp).join("|")})[-._](\\d{1,12})\\b`, "giu");
}

/** Escapes a configured prefix before embedding it in a dynamic regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Returns sorted unique strings for stable API responses. */
function sortedStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

/** Stats a path and returns null when the file is simply absent. */
async function safeStat(target: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Reads one folder's entries with each file's size and mtime. Sub-directories are returned
 * with `isFile: false` and a null size so the UI can flag deeper structure that the mirror
 * does not currently traverse.
 */
async function readDirectoryEntries(absolutePath: string): Promise<ProjectFolderEntry[]> {
  const dirEntries = await readdir(absolutePath, { withFileTypes: true });
  const visible = dirEntries.filter((entry) => !entry.name.startsWith(".") && entry.name !== "Thumbs.db");

  const enriched = await Promise.all(
    visible.map(async (entry): Promise<ProjectFolderEntry> => {
      const entryPath = path.join(absolutePath, entry.name);
      try {
        const info = await stat(entryPath);

        return {
          name: entry.name,
          sizeBytes: info.isFile() ? info.size : null,
          modifiedAt: info.mtime.toISOString(),
          isFile: info.isFile()
        };
      } catch {
        return {
          name: entry.name,
          sizeBytes: null,
          modifiedAt: null,
          isFile: false
        };
      }
    })
  );

  return enriched.sort(compareEntries);
}

/** Sorts files first, then folders, then alphabetically (case-insensitive) within each group. */
function compareEntries(a: ProjectFolderEntry, b: ProjectFolderEntry): number {
  if (a.isFile !== b.isFile) {
    return a.isFile ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * SaveProjectFileResult communicates the outcome of an upload attempt without throwing.
 * Routing maps each variant to a user-readable HTTP response so engineers always get a
 * concrete reason when an upload is rejected.
 */
export type SaveProjectFileResult =
  | {
      status: "ok";
      category: ProjectFolderCategory;
      absolutePath: string;
      entry: ProjectFolderEntry;
    }
  | {
      status: "not_configured";
    }
  | {
      status: "invalid_category";
    }
  | {
      status: "invalid_filename";
      message: string;
    }
  | {
      status: "invalid_content";
      message: string;
    }
  | {
      status: "too_large";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

/**
 * CopyProjectDocumentResult communicates a safe document-map copy attempt.
 *
 * The action only copies a current `move_to_standard_folder` sort-plan row. It never
 * deletes or renames the source, which keeps the old folder tree available for trace.
 */
export type CopyProjectDocumentResult =
  | {
      status: "ok";
      response: ProjectDocumentCopyResponse;
    }
  | {
      status: "not_configured";
    }
  | {
      status: "invalid_source";
      message: string;
    }
  | {
      status: "not_found";
      message: string;
    }
  | {
      status: "not_suggested";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

/**
 * Resolves a raw category string to the canonical ProjectFolderCategory, or null when
 * the category is not one of the supported folders.
 */
export function resolveProjectFolderCategory(raw: string): ProjectFolderCategory | null {
  const match = PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === raw);
  return match ? match.category : null;
}

/**
 * Copies one currently mapped document to its suggested standard folder.
 *
 * The source row is resolved from a fresh document map, not trusted from the browser.
 * That means stale buttons become harmless: if a file was moved, deleted, or no longer
 * has a move suggestion, this returns a typed rejection instead of guessing.
 */
export async function copyProjectDocumentToSuggestedFolder(
  project: ProjectFilesProjectInput,
  input: ProjectDocumentCopyInput
): Promise<CopyProjectDocumentResult> {
  const root = getProjectFilesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  const sourceRelativePath = normalizeRequestedRelativePath(input.sourceRelativePath);
  if (!sourceRelativePath || sourceRelativePath === ".") {
    return {
      status: "invalid_source",
      message: "Choose one mapped file before copying."
    };
  }

  try {
    const safeKey = sanitizeProjectKey(project.projectKey);
    const projectRoot = resolveProjectRoot(root, safeKey);
    await ensureProjectFolderTree(projectRoot);

    const documentMap = await buildProjectDocumentMap(projectRoot);
    const entry = documentMap.documents.find((documentEntry) => documentEntry.relativePath === sourceRelativePath);
    if (!entry) {
      return {
        status: "not_found",
        message: "That file is no longer in the current document map. Reload and try again."
      };
    }

    if (
      entry.sortPlan.action !== "move_to_standard_folder" ||
      !entry.sortPlan.targetCategory ||
      !entry.sortPlan.targetRelativePath
    ) {
      return {
        status: "not_suggested",
        message: "This file does not have a standard-folder copy suggestion."
      };
    }

    const sourceAbsolutePath = resolveProjectRelativePath(projectRoot, entry.relativePath);
    const targetPlanAbsolutePath = resolveProjectRelativePath(projectRoot, entry.sortPlan.targetRelativePath);
    const targetDirectory = path.dirname(targetPlanAbsolutePath);
    const targetFilename = path.basename(targetPlanAbsolutePath);
    const targetFolder = PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === entry.sortPlan.targetCategory);
    if (!targetFolder) {
      return {
        status: "not_suggested",
        message: "The suggested standard folder is not available."
      };
    }

    const categoryRoot = path.join(projectRoot, targetFolder.folderName);
    if (!isPathInside(categoryRoot, targetPlanAbsolutePath)) {
      return {
        status: "invalid_source",
        message: "The suggested copy path escaped its standard folder."
      };
    }

    await mkdir(targetDirectory, { recursive: true });
    const finalFilename = await chooseAvailableFilename(targetDirectory, targetFilename);
    const targetAbsolutePath = path.join(targetDirectory, finalFilename);
    if (!isPathInside(targetDirectory, targetAbsolutePath) || sourceAbsolutePath === targetAbsolutePath) {
      return {
        status: "invalid_source",
        message: "The copy target was not a separate file inside the project folder."
      };
    }

    await copyFile(sourceAbsolutePath, targetAbsolutePath);
    const info = await stat(targetAbsolutePath);

    return {
      status: "ok",
      response: {
        boundary: "Copied to the suggested folder. The original file was left in place.",
        entry: {
          isFile: true,
          modifiedAt: info.mtime.toISOString(),
          name: finalFilename,
          sizeBytes: info.size
        },
        sourceRelativePath: entry.relativePath,
        suggestedRelativePath: entry.sortPlan.targetRelativePath,
        targetAbsolutePath,
        targetCategory: entry.sortPlan.targetCategory,
        targetRelativePath: normalizeRelativePath(path.relative(projectRoot, targetAbsolutePath))
      }
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Project document copy failed."
    };
  }
}

/**
 * Persists one uploaded file inside the requested category folder.
 *
 * Validation order (each step short-circuits with a typed result so the route can return
 * a precise error code):
 *   1. Mirror is configured.
 *   2. Filename sanitizes to something non-empty.
 *   3. Exactly one of contentBase64 / content is provided and decodes cleanly.
 *   4. Decoded payload is non-empty and within MAX_PROJECT_FILE_BYTES.
 *   5. The destination path stays inside the configured root.
 *
 * Filename collisions are resolved by appending a numeric suffix so existing files are
 * never silently overwritten — an engineer's manually-saved file is more important than
 * a perfectly preserved upload name.
 */
export async function saveProjectFile(
  project: ProjectFilesProjectInput,
  category: ProjectFolderCategory,
  input: ProjectFileUploadInput
): Promise<SaveProjectFileResult> {
  const root = getProjectFilesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  const folder = PROJECT_FOLDER_DEFINITIONS.find((definition) => definition.category === category);
  if (!folder) {
    return { status: "invalid_category" };
  }

  const sanitizedFilename = sanitizeUploadFilename(input.filename);
  if (!sanitizedFilename) {
    return {
      status: "invalid_filename",
      message: "Filename must include at least one letter, digit, dash, dot, or underscore."
    };
  }

  const decoded = decodeUploadContent(input);
  if (!decoded.ok) {
    return { status: "invalid_content", message: decoded.message };
  }

  if (decoded.buffer.length === 0) {
    return { status: "invalid_content", message: "File content is empty." };
  }

  if (decoded.buffer.length > MAX_PROJECT_FILE_BYTES) {
    return {
      status: "too_large",
      message: `Files must be ${MAX_PROJECT_FILE_BYTES} bytes or smaller.`
    };
  }

  try {
    const safeKey = sanitizeProjectKey(project.projectKey);
    const projectRoot = resolveProjectRoot(root, safeKey);
    const categoryRoot = path.join(projectRoot, folder.folderName);
    await mkdir(categoryRoot, { recursive: true });

    const finalName = await chooseAvailableFilename(categoryRoot, sanitizedFilename);
    const absolutePath = path.join(categoryRoot, finalName);

    if (!isPathInside(categoryRoot, absolutePath)) {
      return {
        status: "invalid_filename",
        message: "Resolved file path escaped the project folder."
      };
    }

    await writeFile(absolutePath, decoded.buffer);
    const info = await stat(absolutePath);

    return {
      status: "ok",
      absolutePath,
      category,
      entry: {
        name: finalName,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        isFile: true
      }
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Project file upload failed."
    };
  }
}

/**
 * Sanitizes a raw upload filename into a safe basename.
 *
 * Path components (`/`, `\`, drive letters) are stripped, only the basename's safe
 * characters survive, and a leading dot is dropped so we never write hidden files. If
 * the result is empty (e.g., the filename was `..`) the helper returns null so the
 * caller can return a typed error instead of guessing.
 */
export function sanitizeUploadFilename(rawName: string): string | null {
  const basename = path.basename(rawName.trim().replace(/\\/g, "/"));
  if (!basename || basename === "." || basename === "..") {
    return null;
  }

  const dotIndex = basename.lastIndexOf(".");
  const stem = dotIndex > 0 ? basename.slice(0, dotIndex) : basename;
  const ext = dotIndex > 0 ? basename.slice(dotIndex + 1) : "";

  const safeStem = stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");

  const safeExt = ext.replace(/[^A-Za-z0-9]+/g, "").slice(0, 16);

  if (!safeStem) {
    return null;
  }

  return safeExt ? `${safeStem}.${safeExt.toLowerCase()}` : safeStem;
}

/** Normalizes a user-provided document-map path without accepting absolute paths. */
function normalizeRequestedRelativePath(rawPath: string): string | null {
  if (typeof rawPath !== "string") {
    return null;
  }

  const normalized = normalizeRelativePath(rawPath.trim());
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    return null;
  }

  return normalized;
}

/** MAX_SCANNED_UNIMPORTED_FOLDERS bounds document-map work per scan pass so huge drops stay responsive. */
const MAX_SCANNED_UNIMPORTED_FOLDERS = 25;

/** ScanUnimportedProjectFoldersResult reports one mirror-root scan or the disabled state. */
export type ScanUnimportedProjectFoldersResult =
  | { status: "not_configured" }
  | { status: "ok"; response: ProjectFolderScanResponse };

/**
 * Scans the mirror root for folders no library project claims yet, and inside each finds the
 * parts-list candidates the document classifier already recognizes. Existing-project comparison is
 * case-insensitive against the folder each project key resolves to, so a case-variant drop never
 * onboards a duplicate. The scan reads only — it never creates, renames, or reorganizes anything.
 */
export async function scanUnimportedProjectFolders(existingProjectKeys: string[]): Promise<ScanUnimportedProjectFoldersResult> {
  const root = getProjectFilesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  const claimedFolderNames = new Set(existingProjectKeys.map((key) => sanitizeProjectKey(key).toUpperCase()));
  let entries: Dirent[] = [];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return { response: { rootPath: root, skippedExistingCount: 0, truncated: false, unimportedFolders: [] }, status: "ok" };
    }

    throw error;
  }

  const folderNames = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const unimportedNames = folderNames.filter((name) => !claimedFolderNames.has(buildOnboardingRenameTarget(name).toUpperCase()));
  const scannedNames = unimportedNames.slice(0, MAX_SCANNED_UNIMPORTED_FOLDERS);
  const unimportedFolders: ProjectFolderScanEntry[] = [];

  for (const folderName of scannedNames) {
    const folderPath = path.join(root, folderName);
    const documentMap = await buildProjectDocumentMap(folderPath);
    const partsListCandidates = documentMap.documents
      .filter((entry) => entry.documentType === "parts_list")
      .sort((left, right) => right.confidenceScore - left.confidenceScore)
      .slice(0, 3)
      .map((entry) => ({
        confidenceScore: entry.confidenceScore,
        importable: /\.(csv|xlsx)$/iu.test(entry.filename),
        reason: entry.reason,
        relativePath: entry.relativePath
      }));
    const renameTarget = buildOnboardingRenameTarget(folderName);

    unimportedFolders.push({
      bestPartsListRelativePath: partsListCandidates.find((candidate) => candidate.importable)?.relativePath ?? null,
      fileCount: documentMap.documents.length,
      folderName,
      partsListCandidates,
      renameCollision: renameTarget !== folderName && folderNames.some((name) => name !== folderName && name.toUpperCase() === renameTarget.toUpperCase()),
      renameTarget,
      suggestedProjectName: buildSuggestedProjectName(folderName)
    });
  }

  return {
    response: {
      rootPath: root,
      skippedExistingCount: folderNames.length - unimportedNames.length,
      truncated: unimportedNames.length > scannedNames.length,
      unimportedFolders
    },
    status: "ok"
  };
}

/**
 * Computes the folder name onboarding must end at: the sanitized form of the normalized (uppercase,
 * space-collapsed) project key that folder name produces — exactly how every other mirror surface
 * resolves a project's folder.
 */
export function buildOnboardingRenameTarget(folderName: string): string {
  return sanitizeProjectKey(folderName.trim().toUpperCase().replace(/\s+/gu, "-"));
}

/**
 * Derives a plain project-name suggestion from an on-disk folder name.
 */
function buildSuggestedProjectName(folderName: string): string {
  const spaced = folderName.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();

  return spaced.length > 0 ? spaced : folderName;
}

/** RenameFolderForOnboardingResult reports the disclosed onboarding rename or its refusal. */
export type RenameFolderForOnboardingResult =
  | { status: "not_configured" }
  | { status: "invalid_source"; message: string }
  | { status: "collision"; message: string }
  | { status: "ok"; renamedTo: string; renamed: boolean };

/**
 * Renames one mirror-root folder to its project-key form so the created project's mirror resolves
 * to the dropped folder on every filesystem (Linux team servers are case-sensitive). The rename is
 * disclosed in the wizard, changes no file contents, and refuses honestly when the target name is
 * already taken by a different folder.
 */
export async function renameFolderForOnboarding(folderName: string): Promise<RenameFolderForOnboardingResult> {
  const root = getProjectFilesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  const trimmed = folderName.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return { message: "Choose one folder directly under the project files root.", status: "invalid_source" };
  }

  const sourcePath = path.resolve(root, trimmed);
  if (!isPathInside(root, sourcePath)) {
    return { message: "That folder is outside the project files root.", status: "invalid_source" };
  }

  let sourceInfo: Stats;

  try {
    sourceInfo = await stat(sourcePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { message: "That folder is no longer under the project files root.", status: "invalid_source" };
    }

    throw error;
  }

  if (!sourceInfo.isDirectory()) {
    return { message: "That path is a file, not a project folder.", status: "invalid_source" };
  }

  const renamedTo = buildOnboardingRenameTarget(trimmed);

  if (renamedTo === trimmed) {
    return { renamed: false, renamedTo, status: "ok" };
  }

  const targetPath = path.resolve(root, renamedTo);
  if (!isPathInside(root, targetPath)) {
    return { message: "The renamed folder path escaped the project files root.", status: "invalid_source" };
  }

  // A case-only rename resolves to the same directory on case-insensitive filesystems; rename in
  // place. Anything else that already exists at the target is a genuine collision.
  const caseOnlyRename = renamedTo.toUpperCase() === trimmed.toUpperCase();

  if (!caseOnlyRename) {
    try {
      await stat(targetPath);
      return {
        message: `A folder named ${renamedTo} already exists. Rename or merge the folders by hand, then rescan.`,
        status: "collision"
      };
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  await rename(sourcePath, targetPath);

  return { renamed: true, renamedTo, status: "ok" };
}

/** ReadProjectBomSourceResult reports one mirror BOM file read or its explicit non-success state. */
export type ReadProjectBomSourceResult =
  | { status: "not_configured" }
  | { status: "invalid_source"; message: string }
  | { status: "not_found"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "too_large"; message: string }
  | { status: "ok"; response: { sourceFilename: string; sourceFormat: "csv" | "xlsx"; rawContent: string } };

/**
 * Reads one BOM source file (CSV or XLSX) from the project's mirror folder so an engineer can
 * import the parts list the folder already has without re-uploading it through the browser.
 *
 * Path safety mirrors the copy action: the relative path is normalized, resolved inside the
 * project root, and refused when it escapes. The returned `sourceFilename` is the mirror-relative
 * path so BOM provenance records where the file actually lives. Reading never moves, renames, or
 * modifies the file.
 */
export async function readProjectBomSourceFile(
  project: ProjectFilesProjectInput,
  rawRelativePath: string
): Promise<ReadProjectBomSourceResult> {
  const root = getProjectFilesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  const relativePath = normalizeRequestedRelativePath(rawRelativePath);
  if (!relativePath || relativePath === ".") {
    return { message: "Choose one mapped file to import.", status: "invalid_source" };
  }

  const extension = path.extname(relativePath).toLowerCase();

  if (extension === ".xls") {
    return {
      message: "Legacy .xls workbooks cannot be read directly. Open the file in Excel and save it as .xlsx, then rescan the folder.",
      status: "unsupported"
    };
  }

  if (extension !== ".csv" && extension !== ".xlsx") {
    return {
      message: "Only .csv and .xlsx parts lists can be imported from the project folder.",
      status: "unsupported"
    };
  }

  try {
    const safeKey = sanitizeProjectKey(project.projectKey);
    const projectRoot = resolveProjectRoot(root, safeKey);
    const absolutePath = resolveProjectRelativePath(projectRoot, relativePath);
    const info = await stat(absolutePath);

    if (!info.isFile()) {
      return { message: "That path is a folder, not a parts-list file.", status: "invalid_source" };
    }

    if (info.size > MAX_PROJECT_FILE_BYTES) {
      return {
        message: `The file is larger than the ${Math.round(MAX_PROJECT_FILE_BYTES / (1024 * 1024))} MB import limit.`,
        status: "too_large"
      };
    }

    const buffer = await readFile(absolutePath);

    return {
      response: {
        rawContent: extension === ".xlsx" ? buffer.toString("base64") : buffer.toString("utf8"),
        sourceFilename: relativePath,
        sourceFormat: extension === ".xlsx" ? "xlsx" : "csv"
      },
      status: "ok"
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { message: "That file is no longer in the project folder. Reload and try again.", status: "not_found" };
    }

    if (error instanceof Error && /escaped the project folder/u.test(error.message)) {
      return { message: "That path points outside the project folder.", status: "invalid_source" };
    }

    throw error;
  }
}

/**
 * Detects a missing-file filesystem error without matching unrelated failures.
 */
function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Resolves one project-relative path and asserts it stays inside the project folder. */
function resolveProjectRelativePath(projectRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(projectRoot, relativePath.replace(/\//gu, path.sep));
  if (!isPathInside(projectRoot, absolutePath)) {
    throw new Error("Resolved project file path escaped the project folder.");
  }

  return absolutePath;
}

/**
 * Decodes either base64 (binary) or UTF-8 (text) upload content with explicit error
 * messages when both are missing, both are present, or the encoded payload is malformed.
 */
function decodeUploadContent(input: ProjectFileUploadInput): { ok: true; buffer: Buffer } | { ok: false; message: string } {
  const hasBase64 = typeof input.contentBase64 === "string" && input.contentBase64.length > 0;
  const hasText = typeof input.content === "string" && input.content.length > 0;

  if (!hasBase64 && !hasText) {
    return { ok: false, message: "Upload must include contentBase64 or content." };
  }

  if (hasBase64 && hasText) {
    return { ok: false, message: "Upload must include either contentBase64 or content, not both." };
  }

  if (hasBase64) {
    const buffer = decodeBase64Content(input.contentBase64 ?? "");
    if (!buffer) {
      return { ok: false, message: "contentBase64 is not valid base64." };
    }
    return { ok: true, buffer };
  }

  return { ok: true, buffer: Buffer.from(input.content ?? "", "utf8") };
}

/**
 * Decodes base64 text with optional `data:...,` prefix. Mirrors decodeEvidenceUploadContent
 * so both upload paths accept the same browser-friendly forms.
 */
function decodeBase64Content(contentBase64: string): Buffer | null {
  const rawBase64 = contentBase64.includes(",") ? contentBase64.slice(contentBase64.indexOf(",") + 1) : contentBase64;
  const compactBase64 = rawBase64.replace(/\s+/gu, "");

  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compactBase64)) {
    return null;
  }

  return Buffer.from(compactBase64, "base64");
}

/**
 * Returns a filename inside `directory` that does not collide with an existing entry.
 *
 * If `desired` already exists, suffixes `-1`, `-2`, ... are inserted before the extension
 * until a free name is found. The helper bails after a small upper bound so a runaway
 * loop against an unwritable directory cannot lock the API process.
 */
async function chooseAvailableFilename(directory: string, desired: string): Promise<string> {
  const dotIndex = desired.lastIndexOf(".");
  const stem = dotIndex > 0 ? desired.slice(0, dotIndex) : desired;
  const ext = dotIndex > 0 ? desired.slice(dotIndex) : "";

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = attempt === 0 ? desired : `${stem}-${attempt}${ext}`;
    if (!(await pathExists(path.join(directory, candidate)))) {
      return candidate;
    }
  }

  throw new Error("Could not find an available filename after 1000 attempts.");
}

/**
 * Returns true when a path exists; rethrows unexpected fs errors so callers do not
 * silently swallow real failures (permissions, broken symlinks, etc).
 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Returns true when `child` resolves inside `parent`. Used as a final defense before
 * writing so a sanitization regression cannot escape the category folder.
 */
function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Re-exports the type so api/index.ts can keep its imports tidy without reaching into
 * @ee-library/shared for what is logically owned by this module.
 */
export type { ProjectFilesAvailability };
