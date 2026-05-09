/**
 * File header: Project file mirror service.
 *
 * Persists project files outside the database so engineers can also drop files directly
 * into operating-system folders. For each project the service maintains three first-class
 * subfolders — parts list, datasheets, and 3D models — under a configurable root.
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

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
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
 * expected three subfolders, even if no files have been imported yet. Filesystem failures
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
      message: null
    };
  }

  const projectRoot = resolveProjectRoot(root, safeKey);

  try {
    await ensureProjectFolderTree(projectRoot);
    const folders = await readFolderListings(projectRoot);

    return {
      availability: "configured",
      rootPath: projectRoot,
      projectId: project.id,
      projectKey: safeKey,
      folders,
      message: null
    };
  } catch (error) {
    return {
      availability: "error",
      rootPath: projectRoot,
      projectId: project.id,
      projectKey: safeKey,
      folders: [],
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
 * Ensures the project root and its three category subfolders exist on disk. Idempotent:
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
 * the category is not one of the four supported folders.
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
