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

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ProjectCustomHardwareListing,
  ProjectCustomHardwareRecord,
  ProjectFilesAvailability,
  ProjectFilesResponse,
  ProjectFileUploadInput,
  ProjectFolderCategory,
  ProjectFolderEntry,
  ProjectFolderListing
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
      message: null
    };
  }

  const projectRoot = resolveProjectRoot(root, safeKey);

  try {
    await ensureProjectFolderTree(projectRoot);
    const folders = await readFolderListings(projectRoot);
    const customHardware = await readCustomHardwareListing(projectRoot);

    return {
      availability: "configured",
      rootPath: projectRoot,
      projectId: project.id,
      projectKey: safeKey,
      folders,
      customHardware,
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
      message: error instanceof Error ? error.message : "Project file mirror is unavailable."
    };
  }
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
    boundary: "Custom design notes are file-backed provenance only. They do not validate hardware, approve a BOM row, or unlock export.",
    hardwareFolderPath,
    recognizedPrefixes,
    records: Array.from(recordsByPartNumber.values()).sort(compareCustomHardwareRecords)
  };
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
 * Resolves a raw category string to the canonical ProjectFolderCategory, or null when
 * the category is not one of the supported folders.
 */
export function resolveProjectFolderCategory(raw: string): ProjectFolderCategory | null {
  const match = PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === raw);
  return match ? match.category : null;
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
