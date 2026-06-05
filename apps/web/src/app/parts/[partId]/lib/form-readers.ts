/**
 * File header: Safe FormDataEntryValue narrowing for the part detail server actions.
 *
 * These helpers never trust untyped form input — they accept only the exact
 * literal values expected by the backend contract.
 */

import type {
  DocumentAccessLevel,
  DocumentAclPermission,
  DocumentAclPrincipalType,
  DocumentControlType,
  DocumentRedlineSeverity,
  DocumentRedlineStatus,
  DocumentRevisionLifecycleStatus,
  GenerationTargetAssetType,
  ReviewOutcome,
  ReviewTargetType
} from "@ee-library/shared/types";

/**
 * Reads a generation target from form data without trusting arbitrary input.
 */
export function readGenerationTargetAssetType(value: FormDataEntryValue | null): GenerationTargetAssetType | null {
  if (value === "footprint" || value === "symbol" || value === "three_d_model") {
    return value;
  }

  return null;
}

/**
 * Reads a review target type from form data without trusting arbitrary input.
 */
export function readReviewTargetType(value: FormDataEntryValue | null): ReviewTargetType | null {
  if (value === "asset" || value === "generation_workflow") {
    return value;
  }

  return null;
}

/**
 * Reads a review outcome from form data without trusting arbitrary input.
 */
export function readReviewOutcome(value: FormDataEntryValue | null): ReviewOutcome | null {
  if (value === "approved" || value === "changes_requested" || value === "rejected") {
    return value;
  }

  return null;
}

/**
 * Reads a required string from form data without accepting empty strings.
 */
export function readRequiredFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Reads optional form text while converting blanks to null.
 */
export function readOptionalFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Reads a controlled document type from form data without trusting arbitrary input.
 */
export function readDocumentControlType(value: FormDataEntryValue | null): DocumentControlType | null {
  if (value === "datasheet" || value === "mechanical_drawing" || value === "controlled_drawing" || value === "specification" || value === "other") {
    return value;
  }

  return null;
}

/**
 * Reads a controlled document lifecycle status from form data.
 */
export function readDocumentLifecycleStatus(value: FormDataEntryValue | null): DocumentRevisionLifecycleStatus | null {
  if (value === "draft" || value === "in_review" || value === "released" || value === "superseded" || value === "expired" || value === "archived") {
    return value;
  }

  return null;
}

/**
 * Reads a controlled document access level from form data.
 */
export function readDocumentAccessLevel(value: FormDataEntryValue | null): DocumentAccessLevel | null {
  if (value === "public" || value === "internal" || value === "restricted" || value === "itar_controlled") {
    return value;
  }

  return null;
}

/**
 * Reads an ACL principal type from form data.
 */
export function readDocumentAclPrincipalType(value: FormDataEntryValue | null): DocumentAclPrincipalType | null {
  if (value === "user" || value === "team" || value === "role") {
    return value;
  }

  return null;
}

/**
 * Reads an ACL permission from form data.
 */
export function readDocumentAclPermission(value: FormDataEntryValue | null): DocumentAclPermission | null {
  if (value === "view" || value === "review" || value === "approve" || value === "admin") {
    return value;
  }

  return null;
}

/**
 * Reads a redline severity from form data.
 */
export function readDocumentRedlineSeverity(value: FormDataEntryValue | null): DocumentRedlineSeverity | null {
  if (value === "info" || value === "review" || value === "blocker") {
    return value;
  }

  return null;
}

/**
 * Reads a redline workflow status from form data.
 */
export function readDocumentRedlineStatus(value: FormDataEntryValue | null): DocumentRedlineStatus | null {
  if (value === "open" || value === "resolved" || value === "rejected" || value === "superseded") {
    return value;
  }

  return null;
}

/**
 * Reads a positive integer from form data without accepting zero or text.
 */
export function readPositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Builds a single optional ACL grant from the document-control creation form.
 */
export function buildDocumentAclEntryFromForm(formData: FormData) {
  const principalId = readRequiredFormString(formData.get("principalId"));
  const principalType = readDocumentAclPrincipalType(formData.get("principalType"));
  const permission = readDocumentAclPermission(formData.get("permission"));

  if (!principalId || !principalType || !permission) {
    return null;
  }

  return {
    permission,
    principalId,
    principalType
  };
}
