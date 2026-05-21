/**
 * File header: Scans project mirror folders and matches on-disk assets to BOM part names.
 *
 * Part folders and files may use the raw MPN, or slash variants collapsed to no space,
 * underscore, or dash. Matching is deterministic and case-insensitive.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectFolderCategory } from "@ee-library/shared/types";
import { PROJECT_FOLDER_DEFINITIONS } from "./project-files";

/** MirrorAssetCategory is a project mirror folder that can hold per-part deliverables. */
export type MirrorAssetCategory = "datasheets" | "models" | "footprints";

/** MirrorAssetFile is one on-disk file discovered under a mirror category folder. */
export interface MirrorAssetFile {
  /** Mirror category the file was found under. */
  category: MirrorAssetCategory;
  /** Filename including extension. */
  name: string;
  /** Absolute path to the file. */
  absolutePath: string;
  /** Path relative to the project root for operator-facing copy. */
  relativePath: string;
  /** Normalized lookup keys derived from the folder or filename stem. */
  lookupKeys: string[];
}

/** PartsListCandidate is one importable parts-list file in a project mirror. */
export interface PartsListCandidate {
  /** Filename including extension. */
  name: string;
  /** Absolute path to the file. */
  absolutePath: string;
  /** csv or xlsx transport format expected by the BOM importer. */
  sourceFormat: "csv" | "xlsx";
  /** Heuristic score — higher means a better default PL pick. */
  score: number;
}

/** PARTS_LIST_EXTENSIONS names importable parts-list file types. */
const PARTS_LIST_EXTENSIONS = new Set([".csv", ".tsv", ".xlsx"]);

/** ASSET_FILE_EXTENSIONS names extensions linked as engineering deliverables. */
const ASSET_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".txt",
  ".md",
  ".json",
  ".step",
  ".stp",
  ".stl",
  ".iges",
  ".igs",
  ".zip",
  ".kicad_mod",
  ".lib",
  ".schlib",
  ".pcblib",
  ".lia",
  ".olb"
]);

/**
 * Builds normalized lookup keys for one BOM part name so mirror folders can use
 * slash, dash, underscore, or compact spellings interchangeably.
 */
export function buildPartLookupKeys(partName: string): string[] {
  const trimmed = partName.trim();
  const keys = new Set<string>();
  const variants = [
    trimmed,
    trimmed.replace(/[/\\]+/gu, ""),
    trimmed.replace(/[/\\]+/gu, "-"),
    trimmed.replace(/[/\\]+/gu, "_"),
    trimmed.replace(/\s+/gu, ""),
    trimmed.replace(/\s+/gu, "-"),
    trimmed.replace(/\s+/gu, "_")
  ];

  for (const variant of variants) {
    const normalized = normalizePartLookupKey(variant);
    if (normalized) {
      keys.add(normalized);
    }
  }

  return Array.from(keys);
}

/**
 * Picks the best parts-list file from a project mirror parts-list folder.
 */
export async function selectPartsListImportFile(partsListFolderPath: string): Promise<PartsListCandidate | null> {
  const entries = await readdir(partsListFolderPath, { withFileTypes: true });
  const candidates: PartsListCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!PARTS_LIST_EXTENSIONS.has(extension)) {
      continue;
    }

    const loweredName = entry.name.toLowerCase();
    if (loweredName.startsWith("readme")) {
      continue;
    }

    const absolutePath = path.join(partsListFolderPath, entry.name);
    const info = await stat(absolutePath);
    let score = 0;

    if (/(?:^|[-_.])(?:pl|parts(?:[-_.]?list)?|bom)(?:[-_.]|$)/iu.test(loweredName)) {
      score += 40;
    }
    if (extension === ".csv" || extension === ".tsv") {
      score += 10;
    }
    if (extension === ".xlsx") {
      score += 8;
    }

    candidates.push({
      absolutePath,
      name: entry.name,
      score: score + Math.min(5, Math.floor(info.mtimeMs / 1_000_000_000)),
      sourceFormat: extension === ".xlsx" ? "xlsx" : "csv"
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  return candidates[0] ?? null;
}

/**
 * Reads one parts-list file into the raw content shape expected by the BOM importer.
 */
export async function readPartsListImportContent(candidate: PartsListCandidate): Promise<string> {
  if (candidate.sourceFormat === "xlsx") {
    return (await readFile(candidate.absolutePath)).toString("base64");
  }

  return readFile(candidate.absolutePath, "utf8");
}

/**
 * Indexes datasheet, model, and footprint files under a project mirror by part lookup keys.
 */
export async function indexMirrorAssetFiles(
  projectRoot: string,
  categories: readonly MirrorAssetCategory[] = ["datasheets", "models", "footprints"]
): Promise<Map<string, MirrorAssetFile[]>> {
  const index = new Map<string, MirrorAssetFile[]>();

  for (const category of categories) {
    const folderName = getMirrorCategoryFolderName(category);
    const categoryPath = path.join(projectRoot, folderName);
    const files = await collectCategoryAssetFiles(projectRoot, category, categoryPath);

    for (const file of files) {
      for (const key of file.lookupKeys) {
        const bucket = index.get(key) ?? [];
        bucket.push(file);
        index.set(key, bucket);
      }
    }
  }

  return index;
}

/**
 * Finds mirror assets whose lookup keys intersect the supplied part lookup keys.
 */
export function findMirrorAssetsForPart(
  assetIndex: Map<string, MirrorAssetFile[]>,
  partLookupKeys: string[]
): MirrorAssetFile[] {
  const matches = new Map<string, MirrorAssetFile>();

  for (const key of partLookupKeys) {
    for (const file of assetIndex.get(key) ?? []) {
      matches.set(file.absolutePath, file);
    }
  }

  return Array.from(matches.values()).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/**
 * Builds a stable evidence title for one linked mirror asset.
 */
export function buildMirrorAssetEvidenceTitle(file: MirrorAssetFile): string {
  const label = PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === file.category)?.label ?? file.category;

  return `${label}: ${file.name}`;
}

/**
 * Builds operator-facing notes for one linked mirror asset.
 */
export function buildMirrorAssetEvidenceNotes(file: MirrorAssetFile): string {
  return `Linked from the project file mirror at ${file.relativePath}. This path is provenance only; the file was not copied into object storage.`;
}

/**
 * Builds a file:// URL for local mirror paths when the platform allows it.
 */
export function buildMirrorAssetSourceUrl(absolutePath: string): string | null {
  try {
    return new URL(`file:///${absolutePath.replace(/\\/gu, "/")}`).href;
  } catch {
    return null;
  }
}

/**
 * Hashes a mirror file when a lightweight file-backed evidence row is useful.
 */
export async function hashMirrorAssetFile(absolutePath: string): Promise<string | null> {
  try {
    const content = await readFile(absolutePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Returns the on-disk folder name for one mirror asset category.
 */
function getMirrorCategoryFolderName(category: MirrorAssetCategory): string {
  const match = PROJECT_FOLDER_DEFINITIONS.find((folder) => folder.category === category);

  if (!match) {
    throw new Error(`Unsupported mirror asset category: ${category}`);
  }

  return match.folderName;
}

/**
 * Collects asset files from one category folder, including one level of part-named subfolders.
 */
async function collectCategoryAssetFiles(
  projectRoot: string,
  category: MirrorAssetCategory,
  categoryPath: string
): Promise<MirrorAssetFile[]> {
  const files: MirrorAssetFile[] = [];
  const entries = await readdir(categoryPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(categoryPath, entry.name);

    if (entry.isFile()) {
      const asset = await toMirrorAssetFile(projectRoot, category, entryPath, entry.name);
      if (asset) {
        files.push(asset);
      }
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const nestedEntries = await readdir(entryPath, { withFileTypes: true });

    for (const nested of nestedEntries) {
      if (!nested.isFile() || nested.name.startsWith(".")) {
        continue;
      }

      const nestedPath = path.join(entryPath, nested.name);
      const asset = await toMirrorAssetFile(projectRoot, category, nestedPath, nested.name, entry.name);
      if (asset) {
        files.push(asset);
      }
    }
  }

  return files;
}

/**
 * Converts one filesystem file into a mirror asset when it has a supported extension.
 */
async function toMirrorAssetFile(
  projectRoot: string,
  category: MirrorAssetCategory,
  absolutePath: string,
  fileName: string,
  folderName?: string
): Promise<MirrorAssetFile | null> {
  const extension = path.extname(fileName).toLowerCase();
  if (!ASSET_FILE_EXTENSIONS.has(extension)) {
    return null;
  }

  const stems = [folderName, path.basename(fileName, extension)].filter((value): value is string => Boolean(value?.trim()));
  const lookupKeys = new Set<string>();

  for (const stem of stems) {
    for (const key of buildPartLookupKeys(stem)) {
      lookupKeys.add(key);
    }
  }

  if (lookupKeys.size === 0) {
    return null;
  }

  return {
    absolutePath,
    category,
    lookupKeys: Array.from(lookupKeys),
    name: fileName,
    relativePath: path.relative(projectRoot, absolutePath).split(path.sep).join("/")
  };
}

/**
 * Normalizes one part lookup key to a compact lowercase alphanumeric token.
 */
function normalizePartLookupKey(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return normalized.length > 0 ? normalized : null;
}

/**
 * Exposes footprint as a first-class mirror category in shared types.
 */
export function isMirrorAssetCategory(category: ProjectFolderCategory): category is MirrorAssetCategory {
  return category === "datasheets" || category === "models" || category === "footprints";
}
