/**
 * File header: Helpers for uploading project mirror files from the part kit editor.
 */

import type { ProjectPartKitFileCategory, ProjectPartKitFileRef } from "@ee-library/shared/types";

/** PartKitUploadSlot names the project kit file slots that can receive browser uploads. */
export type PartKitUploadSlot = "datasheet" | "model" | "footprint" | "symbol" | "mechanical_drawing";

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
 * Builds a same-origin URL for opening or downloading one project mirror file.
 */
export function buildProjectMirrorFileUrl(projectId: string, relativePath: string, preferInline: boolean): string {
  const params = new URLSearchParams({ relativePath });

  if (!preferInline) {
    params.set("attachment", "1");
  }

  return `/api/projects/${encodeURIComponent(projectId)}/files/download?${params.toString()}`;
}

/**
 * Maps one kit slot to the project mirror category used for uploads.
 */
export function partKitSlotToCategory(slot: PartKitUploadSlot): ProjectPartKitFileCategory {
  if (slot === "datasheet") {
    return "datasheets";
  }

  if (slot === "model") {
    return "models";
  }

  if (slot === "footprint") {
    return "footprints";
  }

  if (slot === "symbol") {
    return "symbols";
  }

  return "mechanical_drawings";
}

/**
 * Builds the file reference shown immediately after a project kit upload completes.
 */
export function buildUploadedPartKitFileRef(slot: PartKitUploadSlot, filename: string): ProjectPartKitFileRef {
  const category = partKitSlotToCategory(slot);
  const folderName = partKitSlotToFolderName(slot);

  return {
    category,
    fileFormat: inferPartKitFileFormat(slot, filename),
    name: filename,
    relativePath: `${folderName}/${filename}`,
    source: "mirror"
  };
}

/**
 * Maps one kit slot to the physical project folder name used in relative paths.
 */
export function partKitSlotToFolderName(slot: PartKitUploadSlot): string {
  if (slot === "mechanical_drawing") {
    return "mechanical-drawings";
  }

  return partKitSlotToCategory(slot);
}

/**
 * Infers the project kit format from the selected slot and uploaded filename.
 */
export function inferPartKitFileFormat(slot: PartKitUploadSlot, filename: string): NonNullable<ProjectPartKitFileRef["fileFormat"]> {
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";

  if (extension === ".pdf") {
    return "pdf";
  }

  if (extension === ".step" || extension === ".stp") {
    return "step";
  }

  if (extension === ".kicad_mod" || extension === ".mod") {
    return "kicad_mod";
  }

  if (extension === ".kicad_sym" || extension === ".sym" || extension === ".lib" || extension === ".schlib") {
    return "kicad_sym";
  }

  if (extension === ".dxf") {
    return "dxf";
  }

  if (slot === "datasheet") {
    return "pdf";
  }

  if (slot === "model") {
    return "step";
  }

  if (slot === "footprint") {
    return "kicad_mod";
  }

  if (slot === "symbol") {
    return "kicad_sym";
  }

  return "dxf";
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
