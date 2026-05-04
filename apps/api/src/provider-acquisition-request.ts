/**
 * File header: Validates admin-facing provider acquisition job bodies without trusting client JSON.
 */

import { isRegisteredProviderImportId } from "@ee-library/worker/provider-part-import";
import type { ProviderAcquisitionJobCreateInput, ProviderLookupMatchType } from "@ee-library/shared/types";

/** ParsedProviderAcquisitionJobCreateRequest is either a validated job body or a user-facing validation failure. */
export type ParsedProviderAcquisitionJobCreateRequest =
  | { ok: true; jobInput: ProviderAcquisitionJobCreateInput }
  | { ok: false; code: string; message: string; statusCode: 400 };

/**
 * Parses and validates one provider acquisition job create body built from an exact provider candidate.
 */
export function parseProviderAcquisitionJobCreateRequest(body: unknown): ParsedProviderAcquisitionJobCreateRequest {
  if (typeof body !== "object" || body === null) {
    return { code: "INVALID_BODY", message: "Request body must be a JSON object.", ok: false, statusCode: 400 };
  }

  const record = body as Record<string, unknown>;
  const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
  const providerPartKey = typeof record.providerPartKey === "string" ? record.providerPartKey.trim() : "";
  const requestedLookup = typeof record.requestedLookup === "string" ? record.requestedLookup.trim() : "";

  if (!providerId) {
    return { code: "MISSING_PROVIDER", message: "Choose a provider.", ok: false, statusCode: 400 };
  }

  if (!isRegisteredProviderImportId(providerId)) {
    return { code: "UNKNOWN_PROVIDER", message: "That provider is not available for import here.", ok: false, statusCode: 400 };
  }

  if (!providerPartKey) {
    return { code: "MISSING_PROVIDER_PART_KEY", message: "Choose a concrete provider candidate before queueing acquisition.", ok: false, statusCode: 400 };
  }

  if (!requestedLookup) {
    return { code: "MISSING_LOOKUP", message: "Provider acquisition jobs require the exact lookup that produced the selected candidate.", ok: false, statusCode: 400 };
  }

  if (!isProviderLookupMatchType(record.matchType)) {
    return { code: "INVALID_MATCH_TYPE", message: "Provider acquisition jobs only accept exact MPN or exact provider id candidates.", ok: false, statusCode: 400 };
  }

  if (record.matchConfidence !== 1) {
    return { code: "INVALID_MATCH_CONFIDENCE", message: "Provider acquisition jobs only accept exact-match candidates with confidence 1.", ok: false, statusCode: 400 };
  }

  if (!isOptionalString(record.manufacturerName) || !isOptionalString(record.mpn) || !isOptionalString(record.package) || !isOptionalString(record.sourceUrl)) {
    return {
      code: "INVALID_CANDIDATE_CONTEXT",
      message: "Manufacturer, MPN, package, and source URL must be strings when provided.",
      ok: false,
      statusCode: 400
    };
  }

  const manufacturerName = normalizeOptionalString(record.manufacturerName);
  const mpn = normalizeOptionalString(record.mpn);
  const packageName = normalizeOptionalString(record.package);
  const sourceUrl = normalizeOptionalString(record.sourceUrl);

  return {
    jobInput: {
      matchConfidence: 1,
      matchType: record.matchType,
      providerId,
      providerPartKey,
      requestedLookup,
      ...(manufacturerName !== undefined ? { manufacturerName } : {}),
      ...(mpn !== undefined ? { mpn } : {}),
      ...(packageName !== undefined ? { package: packageName } : {}),
      ...(sourceUrl !== undefined ? { sourceUrl } : {})
    },
    ok: true
  };
}

/**
 * Checks optional JSON fields that must collapse to strings or null.
 */
function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Normalizes optional string fields so empty text does not persist as fake evidence.
 */
function normalizeOptionalString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return value.trim().length > 0 ? value.trim() : null;
}

/**
 * Narrows exact-match provider candidate types without accepting arbitrary strings.
 */
function isProviderLookupMatchType(value: unknown): value is ProviderLookupMatchType {
  return value === "exact_mpn" || value === "exact_provider_part_id";
}
