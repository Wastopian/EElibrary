/**
 * File header: HTTP request handling for POST /parts/import. Validates the body, gates the call
 * with the shared exact-MPN heuristic, runs runDirectImport, and emits a structured response so
 * the web app can route directly to /parts/:partId on success or render a provider-specific error.
 */

import { classifyExactMpn } from "@ee-library/shared";
import { runDirectImport, type DirectImportFailureReason, type DirectImportRequest, type DirectImportResult } from "@ee-library/worker/direct-import";

/** ImportRouteResponse is what GET /parts/import returns to the web client. */
export type ImportRouteResponse =
  | { status: "imported"; partId: string; mpn: string; providerId: string; alreadyExisted: boolean }
  | { status: "rejected"; reason: string; message: string }
  | { status: "failed"; reason: string; message: string; providerId: string; mpn: string };

/** ImportRouteOutcome wraps the response with the HTTP status code so the route handler stays thin. */
export interface ImportRouteOutcome {
  statusCode: number;
  body: ImportRouteResponse;
}

/** ImportRouteDeps lets tests inject a fake import runner. */
export interface ImportRouteDeps {
  runImport?: (request: DirectImportRequest) => Promise<DirectImportResult>;
}

/**
 * Parses an unknown request body and decides what to do with it.
 * The web app calls this through fetchExactMpnImport in api-client.ts.
 */
export async function handleImportRequest(rawBody: unknown, deps: ImportRouteDeps = {}): Promise<ImportRouteOutcome> {
  const parsed = parseImportBody(rawBody);
  if (parsed.kind === "rejected") {
    return {
      body: { message: parsed.message, reason: parsed.reason, status: "rejected" },
      statusCode: 400
    };
  }

  const runImport = deps.runImport ?? runDirectImport;
  const importRequest: DirectImportRequest = parsed.providerId === undefined ? { mpn: parsed.mpn } : { mpn: parsed.mpn, providerId: parsed.providerId };
  const result = await runImport(importRequest);

  if (result.status === "imported") {
    return {
      body: {
        alreadyExisted: result.alreadyExisted,
        mpn: result.mpn,
        partId: result.partId,
        providerId: result.providerId,
        status: "imported"
      },
      statusCode: result.alreadyExisted ? 200 : 201
    };
  }

  return {
    body: {
      message: result.message,
      mpn: result.mpn,
      providerId: result.providerId,
      reason: result.reason,
      status: "failed"
    },
    statusCode: failureStatusCode(result.reason)
  };
}

/**
 * Maps direct-import failure reasons to the appropriate HTTP status code.
 */
function failureStatusCode(reason: DirectImportFailureReason): number {
  if (reason === "provider_part_not_found" || reason === "provider_not_registered") {
    return 404;
  }
  if (reason === "provider_fetch_failed") {
    return 502;
  }
  return 500;
}

/** ParsedImportBody is the validated shape extracted from the raw JSON body. */
type ParsedImportBody =
  | { kind: "ok"; mpn: string; providerId?: string }
  | { kind: "rejected"; reason: "invalid_body" | "missing_mpn" | "vague_query" | "invalid_provider"; message: string };

/**
 * Validates the import request body and applies the looksLikeExactMpn heuristic.
 * Vague keyword queries are rejected before any provider call so generic searches do not
 * trigger speculative imports.
 */
export function parseImportBody(rawBody: unknown): ParsedImportBody {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { kind: "rejected", message: "Request body must be a JSON object", reason: "invalid_body" };
  }

  const body = rawBody as Record<string, unknown>;
  const mpnRaw = body.mpn;

  if (typeof mpnRaw !== "string" || mpnRaw.trim() === "") {
    return { kind: "rejected", message: "Request body must include `mpn`", reason: "missing_mpn" };
  }

  const classification = classifyExactMpn(mpnRaw);
  if (classification.reason !== "ok") {
    return {
      kind: "rejected",
      message: `Query does not look like an exact MPN (${classification.reason}). Refine the search before importing.`,
      reason: "vague_query"
    };
  }

  if (body.providerId !== undefined) {
    if (typeof body.providerId !== "string" || body.providerId.trim() === "") {
      return { kind: "rejected", message: "providerId must be a non-empty string", reason: "invalid_provider" };
    }
    return { kind: "ok", mpn: classification.value.toUpperCase(), providerId: body.providerId.trim() };
  }

  return { kind: "ok", mpn: classification.value.toUpperCase() };
}
