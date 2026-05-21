/**
 * File header: Helpers for uploading project mirror files from the part kit editor.
 */

import type { ProjectFolderCategory } from "@ee-library/shared/types";

/** MAX_PART_KIT_UPLOAD_BYTES mirrors the API upload cap. */
export const MAX_PART_KIT_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Suggests a mirror filename from the part MPN and selected file extension.
 */
export function suggestPartKitFilename(mpn: string, file: File): string {
  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const stem = sanitizeFilenameStem(mpn);

  return extension ? `${stem}${extension}` : stem;
}

/**
 * Maps one kit slot to the project mirror category used for uploads.
 */
/**
 * Builds a same-origin URL for opening or downloading one project mirror file.
 */
export function buildProjectMirrorFileUrl(projectId: string, relativePath: string, preferInline: boolean): string {
  const params = new URLSearchParams({ relativePath });

  if (!preferInline) {
    params.set("attachment", "1");
  }

  return `/api/projects/${encodeURIComponent(projectId)}/files/download?${params.toString()}`;
}

export function partKitSlotToCategory(slot: "datasheet" | "model" | "footprint"): ProjectFolderCategory {
  if (slot === "datasheet") {
    return "datasheets";
  }

  if (slot === "model") {
    return "models";
  }

  return "footprints";
}

/**
 * Reads one browser file as base64 for the project file upload API.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");

      if (commaIndex < 0) {
        reject(new Error("Could not read the selected file."));
        return;
      }

      resolve(result.slice(commaIndex + 1));
    };

    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Sanitizes an MPN into a safe filename stem.
 */
function sanitizeFilenameStem(mpn: string): string {
  const trimmed = mpn.trim().replace(/[/\\]+/gu, "-");
  const sanitized = trimmed.replace(/[^\w.-]+/gu, "_").replace(/_+/gu, "_").replace(/^-+|-+$/gu, "");

  return sanitized.length > 0 ? sanitized : "part";
}
