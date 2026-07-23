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

/** providerLookupDisplayNames replaces verbose adapter registry names with the supplier names engineers use. */
const providerLookupDisplayNames: Record<string, string> = {
  digikey: "DigiKey",
  jlcparts: "JLCPCB/LCSC",
  kicad: "Local KiCad index",
  "local-catalog": "Local catalog",
  mouser: "Mouser",
  octopart: "Octopart/Nexar"
};

/**
 * Returns the short user-facing supplier name for one provider adapter, falling back to the registry name.
 */
export function formatProviderLookupProviderDisplayName(failure: { providerId: string; providerName: string }): string {
  return providerLookupDisplayNames[failure.providerId] ?? failure.providerName;
}

/**
 * Maps one provider's fan-out failure to a calm per-provider note without leaking provider internals.
 */
export function formatProviderLookupProviderFailureMessage(failure: { providerId: string; providerName: string; message: string }): string {
  const displayName = formatProviderLookupProviderDisplayName(failure);

  if (/(credential|access token|token response|401|403|unauthoriz|forbidden)/iu.test(failure.message)) {
    return `${displayName} did not answer — check credentials.`;
  }

  return `${displayName} did not answer — check network access and try again.`;
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

  if (/Unable to fetch DigiKey/u.test(error.message) || /Unable to fetch Mouser/u.test(error.message) || /Mouser API returned errors/u.test(error.message)) {
    return "Could not reach a supported distributor provider. Check credentials and network access and try again.";
  }

  if (/Unable to fetch Octopart\/Nexar/u.test(error.message) || /Octopart\/Nexar GraphQL returned errors/u.test(error.message)) {
    return "Could not reach a supported provider catalog. Check Octopart/Nexar credentials, network access, and provider plan permissions.";
  }

  return "Provider lookup did not complete.";
}
