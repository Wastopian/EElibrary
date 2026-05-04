/**
 * File header: Validates explicit provider candidate lookup requests without broadening normal catalog search.
 */

import { looksLikeConcreteProviderLookupQuery } from "@ee-library/shared";
import type { ProviderLookupRequestInput } from "@ee-library/shared/types";

/** ParsedProviderLookupRequest is either a validated exact lookup request or a user-facing validation failure. */
export type ParsedProviderLookupRequest =
  | { ok: true; lookupRequest: ProviderLookupRequestInput }
  | { ok: false; code: string; message: string; statusCode: 400 };

/**
 * Parses and validates a provider lookup POST body for Phase 1 exact-match lookup only.
 */
export function parseProviderLookupRequest(body: unknown): ParsedProviderLookupRequest {
  if (typeof body !== "object" || body === null) {
    return { code: "INVALID_BODY", message: "Request body must be a JSON object.", ok: false, statusCode: 400 };
  }

  const record = body as Record<string, unknown>;
  const query = typeof record.query === "string" ? record.query.trim() : "";

  if (!query) {
    return { code: "MISSING_LOOKUP", message: "Enter a concrete MPN or provider part id.", ok: false, statusCode: 400 };
  }

  if (!looksLikeConcreteProviderLookupQuery(query)) {
    return {
      code: "LOOKUP_NOT_SUPPORTED",
      message: "Exact provider lookup only supports concrete MPN or provider part id values. Generic package and keyword lookups are not supported here.",
      ok: false,
      statusCode: 400
    };
  }

  if (record.manufacturerName !== undefined && record.manufacturerName !== null && typeof record.manufacturerName !== "string") {
    return {
      code: "INVALID_MANUFACTURER_HINT",
      message: "Manufacturer hint must be a string when provided.",
      ok: false,
      statusCode: 400
    };
  }

  return {
    lookupRequest: {
      manufacturerName: typeof record.manufacturerName === "string" && record.manufacturerName.trim().length > 0 ? record.manufacturerName.trim() : null,
      query
    },
    ok: true
  };
}

/**
 * Maps provider lookup failures to calm, user-facing wording without leaking provider internals.
 */
export function formatProviderLookupFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Provider lookup did not complete.";
  }

  if (/Unable to fetch jlcparts/u.test(error.message)) {
    return "Could not reach a supported provider catalog. Check your network connection and try again.";
  }

  return "Provider lookup did not complete.";
}
