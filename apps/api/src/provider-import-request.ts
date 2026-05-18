/**
 * File header: Validates provider import HTTP bodies without trusting client JSON.
 */

import { isRegisteredProviderImportId } from "@ee-library/worker/provider-part-import";
import type { ProviderPartRequest } from "@ee-library/worker/provider-part-import";

/** ParsedProviderImportRequest is either a runnable worker request or a validation failure. */
export type ParsedProviderImportRequest =
  | { ok: true; providerId: string; requestedLookup: string; workerRequest: ProviderPartRequest }
  | { ok: false; code: string; message: string; statusCode: 400 };

/**
 * Parses and validates a provider import POST body.
 */
export function parseProviderImportRequest(body: unknown): ParsedProviderImportRequest {
  if (typeof body !== "object" || body === null) {
    return { code: "INVALID_BODY", message: "Request body must be a JSON object.", ok: false, statusCode: 400 };
  }

  const record = body as Record<string, unknown>;
  const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";

  if (!providerId) {
    return { code: "MISSING_PROVIDER", message: "Choose a provider.", ok: false, statusCode: 400 };
  }

  if (!isRegisteredProviderImportId(providerId)) {
    return { code: "UNKNOWN_PROVIDER", message: "That provider is not available for import here.", ok: false, statusCode: 400 };
  }

  const mpn = typeof record.mpn === "string" ? record.mpn.trim() : "";
  const providerPartId = typeof record.providerPartId === "string" ? record.providerPartId.trim() : "";
  const providerUrl = typeof record.providerUrl === "string" ? record.providerUrl.trim() : "";
  const datasheetUrl = typeof record.datasheetUrl === "string" ? record.datasheetUrl.trim() : "";
  const derivedProviderLookup = providerUrl ? extractLookupFromProviderUrl(providerId, providerUrl) : null;
  const effectiveProviderPartId = providerPartId || derivedProviderLookup || "";
  const lookup = effectiveProviderPartId || mpn;

  if (!lookup) {
    return { code: "MISSING_LOOKUP", message: "Enter an MPN or a provider part id.", ok: false, statusCode: 400 };
  }

  const manufacturerName = typeof record.manufacturerName === "string" ? record.manufacturerName.trim() : "";
  const workerRequest: ProviderPartRequest = {
    ...(datasheetUrl.length > 0 ? { datasheetUrl } : {}),
    ...(manufacturerName.length > 0 ? { manufacturerName } : {}),
    ...(mpn.length > 0 ? { mpn } : {}),
    ...(effectiveProviderPartId.length > 0 ? { providerPartId: effectiveProviderPartId } : {}),
    ...(providerUrl.length > 0 ? { providerUrl } : {})
  };

  return { ok: true, providerId, requestedLookup: lookup, workerRequest };
}

/**
 * Maps import failures to calm, user-facing wording without dumping stack traces.
 */
export function formatProviderImportFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Import did not complete.";
  }

  if (/DATABASE_URL is required/u.test(error.message)) {
    return "Imports require a configured catalog database.";
  }

  if (/Unable to fetch jlcparts/u.test(error.message)) {
    return "Could not reach the provider catalog. Check your network connection and try again.";
  }

  if (/DigiKey credentials are not configured/u.test(error.message)) {
    return "DigiKey import requires DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET.";
  }

  if (/Mouser credentials are not configured/u.test(error.message)) {
    return "Mouser import requires MOUSER_API_KEY.";
  }

  if (/Octopart\/Nexar credentials are not configured/u.test(error.message)) {
    return "Octopart/Nexar is an optional paid aggregator and requires configured Nexar credentials. Free providers do not.";
  }

  if (/Unable to fetch DigiKey/u.test(error.message) || /Unable to fetch Mouser/u.test(error.message) || /Mouser API returned errors/u.test(error.message)) {
    return "Could not reach the distributor provider. Check credentials and network access and try again.";
  }

  if (/Unable to fetch Octopart\/Nexar/u.test(error.message) || /Octopart\/Nexar GraphQL returned errors/u.test(error.message)) {
    return "Could not reach the Octopart/Nexar provider. Check credentials, network access, and provider plan permissions.";
  }

  if (/not found for/u.test(error.message) || /metadata record not found/u.test(error.message)) {
    return "No matching catalog entry was found for that lookup. Try another MPN or provider part id.";
  }

  if (/Provider adapter not registered/u.test(error.message)) {
    return "That provider is not available for import here.";
  }

  return "Import did not complete.";
}

/**
 * Extracts a provider lookup key from a known provider product URL when possible.
 */
function extractLookupFromProviderUrl(providerId: string, providerUrl: string): string | null {
  if (providerId === "jlcparts") {
    const lcscMatch = providerUrl.match(/(?:_|\/)(C\d+)(?:\.html?)?$/iu);

    if (lcscMatch?.[1]) {
      return lcscMatch[1];
    }
  }

  try {
    const url = new URL(providerUrl);
    const pathSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
    return pathSegments[pathSegments.length - 1] ?? null;
  } catch {
    return null;
  }
}
