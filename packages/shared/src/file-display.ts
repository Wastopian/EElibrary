/**
 * File header: MIME types and inline/attachment rules for browser file open vs download.
 */

/** FileFormatHint covers catalog asset formats and mirror folder hints. */
export type FileFormatHint = "pdf" | "png" | "jpg" | "jpeg" | "webp" | "step" | "kicad_mod" | "kicad_sym" | "glb" | "gltf" | "dxf" | string;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".dxf": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".kicad_mod": "application/octet-stream",
  ".kicad_sym": "application/octet-stream",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".step": "application/octet-stream",
  ".stp": "application/octet-stream",
  ".webp": "image/webp"
};

const INLINE_FORMATS = new Set<FileFormatHint>(["pdf", "png", "jpg", "jpeg", "webp"]);

/**
 * Returns true when a MIME type can render inline in the browser.
 */
export function isInlineBrowserContentType(contentType: string): boolean {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  return normalized === "application/pdf" || normalized.startsWith("image/");
}

/**
 * Returns true when a stored format should open in the browser instead of downloading.
 */
export function isInlineBrowserFormat(formatHint: FileFormatHint | null | undefined): boolean {
  return formatHint != null && INLINE_FORMATS.has(formatHint);
}

/**
 * Resolves Content-Type from a filename extension and optional catalog format hint.
 */
export function resolveStoredFileContentType(filename: string, formatHint?: FileFormatHint | null): string {
  const extension = extractFilenameExtension(filename);
  const fromExtension = EXTENSION_CONTENT_TYPES[extension];

  if (fromExtension) {
    return fromExtension;
  }

  const inferred = inferFormatHintFromFilename(filename) ?? formatHint ?? null;

  if (inferred === "pdf") {
    return "application/pdf";
  }

  if (inferred === "png") {
    return "image/png";
  }

  if (inferred === "jpg" || inferred === "jpeg") {
    return "image/jpeg";
  }

  if (inferred === "webp") {
    return "image/webp";
  }

  return "application/octet-stream";
}

/**
 * Maps a project mirror folder prefix to the expected file format.
 */
export function inferMirrorPathFormat(relativePath: string): FileFormatHint | null {
  const folder = relativePath.split("/")[0]?.trim().toLowerCase() ?? "";

  if (folder === "datasheets") {
    return "pdf";
  }

  if (folder === "models") {
    return "step";
  }

  if (folder === "footprints") {
    return "kicad_mod";
  }

  return null;
}

/**
 * Returns true when a download request should use Content-Disposition: inline.
 */
export function shouldServeFileInline(
  searchParams: URLSearchParams,
  formatHint: FileFormatHint | null | undefined,
  contentType: string
): boolean {
  if (searchParams.get("attachment") === "1" || searchParams.get("attachment") === "true") {
    return false;
  }

  if (searchParams.get("inline") === "1" || searchParams.get("inline") === "true") {
    return true;
  }

  return isInlineBrowserFormat(formatHint) || isInlineBrowserContentType(contentType);
}

/**
 * Builds Content-Disposition for inline or attachment delivery.
 */
export function buildFileContentDisposition(filename: string, inline: boolean): string {
  return `${inline ? "inline" : "attachment"}; filename="${filename}"`;
}

function extractFilenameExtension(filename: string): string {
  if (!filename.includes(".")) {
    return "";
  }

  return filename.slice(filename.lastIndexOf(".")).toLowerCase();
}

function inferFormatHintFromFilename(filename: string): FileFormatHint | null {
  const extension = extractFilenameExtension(filename);

  if (extension === ".pdf") {
    return "pdf";
  }

  const stem = extension ? filename.slice(0, -extension.length) : filename;

  if (/-pdf$/iu.test(stem)) {
    return "pdf";
  }

  if (/-stp$/iu.test(stem) || /-step$/iu.test(stem)) {
    return "step";
  }

  return null;
}
