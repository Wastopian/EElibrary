/**
 * File header: Vendor notes service.
 *
 * Persists institutional supplier knowledge (PCB fabs, sheet metal shops, machinists,
 * finishers, assembly houses, distributors) outside the database so engineers can also
 * drop notes and reference files into operating-system folders. Each vendor lives in
 * `<root>/<category>/<slug>/` with a tiny `vendor.json` metadata file plus two
 * subfolders: `notes/` for Markdown decisions and `files/` for uploaded reference docs.
 *
 * The root resolves in this order:
 *   1. The `EE_LIBRARY_VENDOR_NOTES_ROOT` environment variable (absolute or relative).
 *   2. The default `<user-home>/EE-Library/vendors` location, parallel to the project
 *      file mirror.
 *
 * Path safety: vendor slugs are derived from names, sanitized, and the resolved per-
 * vendor path is asserted to live inside the configured root before any read or write.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ProjectFolderEntry,
  Vendor,
  VendorAvailability,
  VendorCategory,
  VendorCreateInput,
  VendorDetailResponse,
  VendorFileUploadInput,
  VendorFolderSection,
  VendorListResponse,
  VendorSummary
} from "@ee-library/shared/types";

/** VendorCategoryDefinition pairs a category with the on-disk folder name and friendly copy. */
interface VendorCategoryDefinition {
  category: VendorCategory;
  /** On-disk folder name for this category. Stable so engineers can rely on it. */
  folderName: string;
  /** Short human-readable label rendered in the UI. */
  label: string;
}

/**
 * VENDOR_CATEGORY_DEFINITIONS is the canonical list of categories surfaced in the UI.
 * Order is preserved so the list page renders categories in a consistent sequence.
 */
export const VENDOR_CATEGORY_DEFINITIONS: readonly VendorCategoryDefinition[] = [
  { category: "pcb_fab", folderName: "pcb-fab", label: "PCB fab" },
  { category: "sheet_metal", folderName: "sheet-metal", label: "Sheet metal" },
  { category: "machining", folderName: "machining", label: "Machining" },
  { category: "finishing", folderName: "finishing", label: "Anodize / finishing" },
  { category: "electronics_assembly", folderName: "electronics-assembly", label: "Electronics assembly" },
  { category: "distributor", folderName: "distributor", label: "Distributor" },
  { category: "other", folderName: "other", label: "Other" }
] as const;

/** VENDOR_FOLDER_SECTIONS lists the two sub-folders inside one vendor record. */
export const VENDOR_FOLDER_SECTIONS: readonly VendorFolderSection[] = ["notes", "files"] as const;

/**
 * MAX_VENDOR_FILE_BYTES bounds one upload through the JSON+base64 transport. Mirrors
 * the project file mirror so behavior feels consistent across the workspace.
 */
export const MAX_VENDOR_FILE_BYTES = 25 * 1024 * 1024;

/** VENDOR_METADATA_FILENAME is the on-disk filename for one vendor's metadata sidecar. */
const VENDOR_METADATA_FILENAME = "vendor.json";

/** VENDOR_NAME_MAX_LENGTH bounds free-text vendor names so list rendering stays calm. */
const VENDOR_NAME_MAX_LENGTH = 120;

/** VENDOR_SUMMARY_MAX_LENGTH bounds free-text vendor one-liners. */
const VENDOR_SUMMARY_MAX_LENGTH = 240;

/**
 * Returns the absolute vendor notes root, or null when explicitly disabled.
 *
 * Setting `EE_LIBRARY_VENDOR_NOTES_ROOT=off` disables the vendor notebook. An empty
 * value is treated the same as an unset value so copied example env files still get the
 * local default folder.
 */
export function getVendorNotesRoot(): string | null {
  const raw = process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "off") {
      return null;
    }
    if (trimmed.length === 0) {
      return path.resolve(homedir(), "EE-Library", "vendors");
    }
    return path.resolve(trimmed);
  }

  return path.resolve(homedir(), "EE-Library", "vendors");
}

/**
 * Resolves a raw category string to the canonical VendorCategory, or null when the
 * category is not one of the supported supplier classes.
 */
export function resolveVendorCategory(raw: string): VendorCategory | null {
  const match = VENDOR_CATEGORY_DEFINITIONS.find((definition) => definition.category === raw);
  return match ? match.category : null;
}

/** Resolves a raw section string to "notes" or "files", or null otherwise. */
export function resolveVendorFolderSection(raw: string): VendorFolderSection | null {
  return raw === "notes" || raw === "files" ? raw : null;
}

/**
 * Slugifies a vendor name into a safe URL+folder segment.
 *
 * Lowercases, strips diacritics, replaces non-alphanum runs with a single dash, and
 * trims dashes from the ends. Returns null when nothing usable remains so the API can
 * reject the create request with a typed error.
 */
export function slugifyVendorName(rawName: string): string | null {
  const trimmed = rawName.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const ascii = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return ascii.length > 0 ? ascii : null;
}

/**
 * BuildVendorListResponse walks every category folder, reads the per-vendor metadata,
 * and returns a sorted list of summaries. Missing or malformed metadata files are
 * surfaced as fallback records using the folder name so engineers can audit drift on
 * disk without losing visibility.
 */
export async function buildVendorListResponse(): Promise<VendorListResponse> {
  const root = getVendorNotesRoot();

  if (!root) {
    return {
      availability: "not_configured",
      rootPath: null,
      vendors: [],
      message: null
    };
  }

  try {
    await ensureVendorRoot(root);
    const summaries: VendorSummary[] = [];

    for (const definition of VENDOR_CATEGORY_DEFINITIONS) {
      const categoryRoot = path.join(root, definition.folderName);
      const dirEntries = await safeReadDir(categoryRoot);

      for (const entry of dirEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const summary = await readVendorSummary(root, definition.category, entry.name);
        if (summary) {
          summaries.push(summary);
        }
      }
    }

    summaries.sort((a, b) => a.vendor.name.localeCompare(b.vendor.name, undefined, { sensitivity: "base" }));

    return {
      availability: "configured",
      rootPath: root,
      vendors: summaries,
      message: null
    };
  } catch (error) {
    return {
      availability: "error",
      rootPath: root,
      vendors: [],
      message: error instanceof Error ? error.message : "Vendor notes mirror is unavailable."
    };
  }
}

/**
 * BuildVendorDetailResponse returns one vendor with its notes and files folder listings.
 * Returns availability=`configured` with `vendor: null` when the slug does not exist so
 * the UI can render a calm 404 instead of confusing "files unavailable" copy.
 */
export async function buildVendorDetailResponse(slug: string): Promise<VendorDetailResponse> {
  const root = getVendorNotesRoot();

  if (!root) {
    return {
      availability: "not_configured",
      rootPath: null,
      vendor: null,
      notes: [],
      files: [],
      notesPath: null,
      filesPath: null,
      message: null
    };
  }

  try {
    const located = await locateVendorBySlug(root, slug);
    if (!located) {
      return {
        availability: "configured",
        rootPath: root,
        vendor: null,
        notes: [],
        files: [],
        notesPath: null,
        filesPath: null,
        message: null
      };
    }

    const vendor = located.vendor;
    const vendorRoot = located.absolutePath;
    const notesPath = path.join(vendorRoot, "notes");
    const filesPath = path.join(vendorRoot, "files");

    await mkdir(notesPath, { recursive: true });
    await mkdir(filesPath, { recursive: true });

    const [notes, files] = await Promise.all([
      readFolderEntries(notesPath),
      readFolderEntries(filesPath)
    ]);

    return {
      availability: "configured",
      rootPath: root,
      vendor,
      notes,
      files,
      notesPath,
      filesPath,
      message: null
    };
  } catch (error) {
    return {
      availability: "error",
      rootPath: root,
      vendor: null,
      notes: [],
      files: [],
      notesPath: null,
      filesPath: null,
      message: error instanceof Error ? error.message : "Vendor notes mirror is unavailable."
    };
  }
}

/**
 * CreateVendorResult communicates the outcome of a create attempt without throwing.
 * Routing maps each variant to a precise HTTP response so the UI can surface accurate
 * recovery copy.
 */
export type CreateVendorResult =
  | { status: "ok"; vendor: Vendor }
  | { status: "not_configured" }
  | { status: "invalid_name"; message: string }
  | { status: "invalid_category" }
  | { status: "invalid_summary"; message: string }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

/**
 * Persists one new vendor record by writing a small JSON metadata sidecar and ensuring
 * its `notes/` and `files/` subfolders exist. Slug collisions return `conflict` so the
 * engineer can decide whether to rename or open the existing record.
 */
export async function createVendor(input: VendorCreateInput): Promise<CreateVendorResult> {
  const root = getVendorNotesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  if (typeof input.name !== "string") {
    return { status: "invalid_name", message: "Vendor name must be a string." };
  }

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { status: "invalid_name", message: "Vendor name is required." };
  }
  if (trimmedName.length > VENDOR_NAME_MAX_LENGTH) {
    return { status: "invalid_name", message: `Vendor name must be ${VENDOR_NAME_MAX_LENGTH} characters or fewer.` };
  }

  const category = resolveVendorCategory(input.category);
  if (!category) {
    return { status: "invalid_category" };
  }

  const slug = slugifyVendorName(trimmedName);
  if (!slug) {
    return { status: "invalid_name", message: "Vendor name must include at least one letter or number." };
  }

  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (summary.length > VENDOR_SUMMARY_MAX_LENGTH) {
    return { status: "invalid_summary", message: `Summary must be ${VENDOR_SUMMARY_MAX_LENGTH} characters or fewer.` };
  }

  try {
    await ensureVendorRoot(root);

    const existing = await locateVendorBySlug(root, slug);
    if (existing) {
      return { status: "conflict", message: `A vendor already exists at /vendors/${slug}.` };
    }

    const definition = VENDOR_CATEGORY_DEFINITIONS.find((entry) => entry.category === category);
    if (!definition) {
      return { status: "invalid_category" };
    }

    const vendorRoot = path.join(root, definition.folderName, slug);
    if (!isPathInside(root, vendorRoot)) {
      return { status: "error", message: "Resolved vendor folder escaped the configured root." };
    }

    await mkdir(vendorRoot, { recursive: true });
    await mkdir(path.join(vendorRoot, "notes"), { recursive: true });
    await mkdir(path.join(vendorRoot, "files"), { recursive: true });

    const now = new Date().toISOString();
    const vendor: Vendor = {
      slug,
      name: trimmedName,
      category,
      summary,
      createdAt: now,
      updatedAt: now
    };

    await writeFile(path.join(vendorRoot, VENDOR_METADATA_FILENAME), JSON.stringify(vendor, null, 2));

    return { status: "ok", vendor };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to create vendor record."
    };
  }
}

/**
 * SaveVendorFileResult mirrors SaveProjectFileResult shape for routing convenience.
 */
export type SaveVendorFileResult =
  | { status: "ok"; section: VendorFolderSection; absolutePath: string; entry: ProjectFolderEntry }
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "invalid_section" }
  | { status: "invalid_filename"; message: string }
  | { status: "invalid_content"; message: string }
  | { status: "too_large"; message: string }
  | { status: "error"; message: string };

/**
 * Persists one uploaded file inside the requested vendor section.
 *
 * Validation order (each step short-circuits with a typed result):
 *   1. Mirror is configured.
 *   2. Vendor slug exists.
 *   3. Section is "notes" or "files".
 *   4. Filename sanitizes to something non-empty.
 *   5. Exactly one of contentBase64 / content is provided and decodes cleanly.
 *   6. Decoded payload is non-empty and within MAX_VENDOR_FILE_BYTES.
 *
 * Filename collisions are resolved by appending a numeric suffix so existing files are
 * never silently overwritten.
 */
export async function saveVendorFile(
  slug: string,
  section: VendorFolderSection,
  input: VendorFileUploadInput
): Promise<SaveVendorFileResult> {
  const root = getVendorNotesRoot();
  if (!root) {
    return { status: "not_configured" };
  }

  if (section !== "notes" && section !== "files") {
    return { status: "invalid_section" };
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

  if (decoded.buffer.length > MAX_VENDOR_FILE_BYTES) {
    return {
      status: "too_large",
      message: `Files must be ${MAX_VENDOR_FILE_BYTES} bytes or smaller.`
    };
  }

  try {
    const located = await locateVendorBySlug(root, slug);
    if (!located) {
      return { status: "not_found" };
    }

    const sectionRoot = path.join(located.absolutePath, section);
    await mkdir(sectionRoot, { recursive: true });

    const finalName = await chooseAvailableFilename(sectionRoot, sanitizedFilename);
    const absolutePath = path.join(sectionRoot, finalName);
    if (!isPathInside(sectionRoot, absolutePath)) {
      return {
        status: "invalid_filename",
        message: "Resolved file path escaped the vendor folder."
      };
    }

    await writeFile(absolutePath, decoded.buffer);
    const info = await stat(absolutePath);

    await touchVendorMetadata(located.absolutePath, located.vendor);

    return {
      status: "ok",
      absolutePath,
      section,
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
      message: error instanceof Error ? error.message : "Vendor file upload failed."
    };
  }
}

/** Ensures the configured vendor root and each category folder exist on disk. */
async function ensureVendorRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const definition of VENDOR_CATEGORY_DEFINITIONS) {
    await mkdir(path.join(root, definition.folderName), { recursive: true });
  }
}

/**
 * Reads `vendor.json` for one folder under one category and returns a populated summary.
 * Folders without metadata are surfaced as fallback records so engineers can see drift.
 */
async function readVendorSummary(root: string, category: VendorCategory, folderName: string): Promise<VendorSummary | null> {
  const definition = VENDOR_CATEGORY_DEFINITIONS.find((entry) => entry.category === category);
  if (!definition) {
    return null;
  }

  const slug = folderName;
  const vendorRoot = path.join(root, definition.folderName, folderName);
  const metadataPath = path.join(vendorRoot, VENDOR_METADATA_FILENAME);

  let vendor: Vendor;
  try {
    const raw = await readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Vendor>;
    vendor = normalizeVendorMetadata(parsed, { slug, category });
  } catch (error) {
    const fallback = await buildFallbackVendorFromFolder(vendorRoot, slug, category, error);
    if (!fallback) {
      throw error;
    }
    vendor = fallback;
  }

  const [noteEntries, fileEntries] = await Promise.all([
    safeReadDir(path.join(vendorRoot, "notes")),
    safeReadDir(path.join(vendorRoot, "files"))
  ]);

  return {
    vendor,
    noteCount: countVisibleFiles(noteEntries),
    fileCount: countVisibleFiles(fileEntries)
  };
}

/**
 * Locates a vendor record by slug across every category folder. Returns the metadata
 * record alongside the absolute path so callers can read or write further structure
 * without duplicating filesystem scans.
 */
async function locateVendorBySlug(root: string, rawSlug: string): Promise<{ vendor: Vendor; absolutePath: string } | null> {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug) {
    return null;
  }

  for (const definition of VENDOR_CATEGORY_DEFINITIONS) {
    const candidate = path.join(root, definition.folderName, slug);
    if (!isPathInside(root, candidate)) {
      continue;
    }
    const metadataPath = path.join(candidate, VENDOR_METADATA_FILENAME);
    try {
      const raw = await readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Vendor>;
      const vendor = normalizeVendorMetadata(parsed, { slug, category: definition.category });
      return { vendor, absolutePath: candidate };
    } catch (error) {
      const fallback = await buildFallbackVendorFromFolder(candidate, slug, definition.category, error);
      if (fallback) {
        return { vendor: fallback, absolutePath: candidate };
      }
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }

  return null;
}

/**
 * Builds a calm vendor fallback for folders whose metadata sidecar is missing or was
 * hand-edited into invalid JSON. Permission and other filesystem failures still bubble
 * up so the UI can report the vendor mirror as unavailable instead of hiding damage.
 */
async function buildFallbackVendorFromFolder(
  vendorRoot: string,
  slug: string,
  category: VendorCategory,
  readError: unknown
): Promise<Vendor | null> {
  const code = (readError as NodeJS.ErrnoException | null)?.code;
  const canFallback = code === "ENOENT" || readError instanceof SyntaxError;
  if (!canFallback) {
    return null;
  }

  const stats = await stat(vendorRoot).catch(() => null);
  if (!stats?.isDirectory()) {
    return null;
  }

  return {
    slug,
    name: slug,
    category,
    summary: "",
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString()
  };
}

/** Updates the on-disk `updatedAt` timestamp without losing the original createdAt. */
async function touchVendorMetadata(vendorRoot: string, vendor: Vendor): Promise<void> {
  const metadataPath = path.join(vendorRoot, VENDOR_METADATA_FILENAME);
  const next: Vendor = {
    ...vendor,
    updatedAt: new Date().toISOString()
  };
  await writeFile(metadataPath, JSON.stringify(next, null, 2));
}

/**
 * Coerces an arbitrary JSON object into a Vendor with calm fallbacks. Defends against
 * hand-edited `vendor.json` files where a field went missing or got renamed.
 */
function normalizeVendorMetadata(parsed: Partial<Vendor>, fallback: { slug: string; category: VendorCategory }): Vendor {
  const slug = typeof parsed.slug === "string" && parsed.slug.length > 0 ? parsed.slug : fallback.slug;
  const name = typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : slug;
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString();
  const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : createdAt;
  const category = parsed.category && resolveVendorCategory(parsed.category) ? parsed.category : fallback.category;

  return { slug, name, category, summary, createdAt, updatedAt };
}

/** Reads a folder's entries with file size and mtime, sorted files-first, then alphabetically. */
async function readFolderEntries(absolutePath: string): Promise<ProjectFolderEntry[]> {
  const dirEntries = await safeReadDir(absolutePath);
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

/** Counts visible regular files in a directory, ignoring hidden cruft and sub-directories. */
function countVisibleFiles(entries: { name: string; isFile: () => boolean }[]): number {
  return entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name !== "Thumbs.db").length;
}

/** Reads a directory and returns [] when it does not exist instead of throwing ENOENT. */
async function safeReadDir(target: string): Promise<{ name: string; isFile: () => boolean; isDirectory: () => boolean }[]> {
  try {
    return await readdir(target, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** Returns true when `child` resolves inside `parent`. */
function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Sanitizes a raw upload filename into a safe basename. Mirrors the project files
 * helper so the two surfaces feel consistent.
 */
function sanitizeUploadFilename(rawName: string): string | null {
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

/** Decodes either base64 (binary) or UTF-8 (text) upload content with explicit errors. */
function decodeUploadContent(input: VendorFileUploadInput): { ok: true; buffer: Buffer } | { ok: false; message: string } {
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

/** Decodes base64 text with optional `data:...,` prefix. */
function decodeBase64Content(contentBase64: string): Buffer | null {
  const rawBase64 = contentBase64.includes(",") ? contentBase64.slice(contentBase64.indexOf(",") + 1) : contentBase64;
  const compactBase64 = rawBase64.replace(/\s+/gu, "");

  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compactBase64)) {
    return null;
  }

  return Buffer.from(compactBase64, "base64");
}

/** Returns a filename inside `directory` that does not collide with an existing entry. */
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

export type { VendorAvailability };
