/**
 * File header: Provides the provider-neutral HTTP API for catalog search and detail reads.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { filterSortAndPaginatePartRecords, getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { CatalogStoreError, createGenerationRequestInDatabase, createReviewInDatabase, getCatalogStoreStatus, promoteAssetForExportInDatabase, readCatalogRecordsFromDatabase, readPartDetailRecordsFromDatabase, readPartSearchRecordsFromDatabase } from "./catalog-store";
import { resolveCatalogRecords, resolveCatalogSearchRecords } from "./catalog-resolver";
import { buildPartDetailResponse } from "./detail-response";
import type { CatalogQueryTiming } from "./catalog-store";
import type { ApiEnvelope, AssetPromotionInput, CadAvailabilityFilter, CatalogDataSource, GenerationRequestCreateInput, GenerationTargetAssetType, PartSearchFilters, PartSearchRecord, PartSearchSort, ReviewActionInput, ReviewOutcome, ReviewTargetType, SearchPagination } from "@ee-library/shared/types";

/** port is the local HTTP port for the API process. */
const port = Number(process.env.API_PORT ?? 4000);

/** RouteTiming stores one measured operation for headers and local logs. */
interface RouteTiming {
  /** Stable operation name used by Server-Timing. */
  name: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Optional row count or result size detail for local logs. */
  detail?: string;
}

/** RouteTelemetry tracks one HTTP request without changing response payloads. */
interface RouteTelemetry {
  /** Route operation name, such as api-search or api-part-detail. */
  operation: string;
  /** Request path for local structured logs. */
  path: string;
  /** Request method. */
  method: string;
  /** Request start time from the monotonic clock. */
  startedAt: number;
  /** Timed route and DB operations. */
  timings: RouteTiming[];
}

/** responseTelemetry carries request timing state until sendJson writes the response. */
const responseTelemetry = new WeakMap<ServerResponse, RouteTelemetry>();

/**
 * Handles every incoming HTTP request with explicit route boundaries.
 */
export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL" });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  beginRouteTelemetry(response, request.method ?? "UNKNOWN", url.pathname);
  const generationRequestMatch = /^\/parts\/([^/]+)\/generation-requests$/u.exec(url.pathname);
  const promotionActionMatch = /^\/parts\/([^/]+)\/asset-promotions$/u.exec(url.pathname);
  const reviewActionMatch = /^\/parts\/([^/]+)\/reviews$/u.exec(url.pathname);

  if (request.method === "POST" && generationRequestMatch?.[1]) {
    await handleGenerationRequestCreate(request, response, generationRequestMatch[1]);
    return;
  }

  if (request.method === "POST" && reviewActionMatch?.[1]) {
    await handleReviewActionCreate(request, response, reviewActionMatch[1]);
    return;
  }

  if (request.method === "POST" && promotionActionMatch?.[1]) {
    await handleAssetPromotionCreate(request, response, promotionActionMatch[1]);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Only GET, generation-request POST, review POST, and asset-promotion POST routes are enabled for the catalog API" });
    return;
  }

  if (url.pathname === "/health") {
    const database = await timeRouteOperation(response, "catalog-status", () => getCatalogStoreStatus(), (status) => status.label);

    sendJson(response, 200, {
      dependencies: {
        database: database.label,
        objectStorage: "not_connected_phase_0",
        queue: "not_connected_phase_0"
      },
      service: "api",
      status: "ok"
    });
    return;
  }

  if (url.pathname === "/parts") {
    const filters = readSearchFilters(url);
    const catalog = await timeRouteOperation(
      response,
      "catalog-resolve-search",
      () => resolveCatalogSearchRecords(() => readPartSearchRecordsFromDatabase(filters, { onQueryTiming: buildQueryTimingSink(response) }), () => loadSeedSearchRecords(filters)),
      (result) => (result.ok ? `${result.records.length}/${result.pagination.totalRecords} records from ${result.source}` : result.body.error.code)
    );

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    sendCatalogJson(response, catalog.records, catalog.source, catalog.warnings, catalog.pagination);
    return;
  }

  if (url.pathname === "/parts/facets") {
    const catalog = await timeRouteOperation(
      response,
      "catalog-resolve-facets",
      () => resolveCatalogRecords(() => readCatalogRecordsFromDatabase({ onQueryTiming: buildQueryTimingSink(response) }), loadSeedCatalogRecords),
      (result) => (result.ok ? `${result.records.length} records from ${result.source}` : result.body.error.code)
    );

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    const facets = timeSyncRouteOperation(response, "search-facets", () => getSearchFacetsFromRecords(catalog.records), (result) => `${result.manufacturers.length} manufacturers`);

    sendCatalogJson(response, facets, catalog.source, catalog.warnings);
    return;
  }

  const partMatch = /^\/parts\/([^/]+)$/u.exec(url.pathname);

  if (partMatch?.[1]) {
    const partId = partMatch[1];
    const catalog = await timeRouteOperation(
      response,
      "catalog-resolve-detail",
      () => resolveCatalogRecords(() => readPartDetailRecordsFromDatabase(partId, { onQueryTiming: buildQueryTimingSink(response) }), loadSeedCatalogRecords),
      (result) => (result.ok ? `${result.records.length} records from ${result.source}` : result.body.error.code)
    );

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    const records = catalog.records;
    const record = records.find((candidate) => candidate.part.id === partMatch[1]);

    if (!record) {
      sendJson(response, 404, { error: "Part not found" });
      return;
    }

    const detailResponse = timeSyncRouteOperation(response, "detail-build", () => buildPartDetailResponse(record, records), (result) => `${result.relatedPartSummaries.length} related summaries`);

    sendCatalogJson(response, detailResponse, catalog.source, catalog.warnings);
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
}

/**
 * Handles local/dev-safe generation request creation without simulating output assets.
 */
async function handleGenerationRequestCreate(request: IncomingMessage, response: ServerResponse, partId: string): Promise<void> {
  const body = await readJsonBody<GenerationRequestCreateInput>(request);

  if (!body || !isGenerationTargetAssetType(body.targetAssetType)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_GENERATION_REQUEST",
        message: "Generation requests require a targetAssetType of footprint, symbol, or three_d_model."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "generation-request-create", () => createGenerationRequestInDatabase(partId, body.targetAssetType), (value) => value.status);

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Generation requests require a configured database so request state can be persisted."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "PART_NOT_FOUND",
          message: "Part not found."
        }
      });
      return;
    }

    if (result.status === "not_requestable") {
      sendJson(response, 409, {
        error: {
          code: "GENERATION_NOT_REQUESTABLE",
          message: result.reason
        }
      });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles local/dev-safe review actions without simulating generation or export verification.
 */
async function handleReviewActionCreate(request: IncomingMessage, response: ServerResponse, partId: string): Promise<void> {
  const body = await readJsonBody<ReviewActionInput>(request);

  if (!body || !isReviewTargetType(body.targetType) || !isReviewOutcome(body.outcome) || typeof body.targetId !== "string" || body.targetId.trim().length === 0) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_REVIEW_ACTION",
        message: "Review actions require targetType, targetId, and an outcome of approved, rejected, or changes_requested."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "review-action-create",
      () =>
        createReviewInDatabase(partId, {
          notes: typeof body.notes === "string" ? body.notes : null,
          outcome: body.outcome,
          targetId: body.targetId,
          targetType: body.targetType
        }),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Review actions require a configured database so review state can be persisted."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "REVIEW_TARGET_NOT_FOUND",
          message: result.reason
        }
      });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles explicit promotion from approved draft/reviewed asset into export verification.
 */
async function handleAssetPromotionCreate(request: IncomingMessage, response: ServerResponse, partId: string): Promise<void> {
  const body = await readJsonBody<AssetPromotionInput>(request);

  if (!body || typeof body.assetId !== "string" || body.assetId.trim().length === 0) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_ASSET_PROMOTION",
        message: "Asset promotion requires an assetId."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "promotion-action-create", () => promoteAssetForExportInDatabase(partId, body.assetId), (value) => value.status);

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Asset promotion requires a configured database so export verification can be persisted."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "PROMOTION_TARGET_NOT_FOUND",
          message: result.reason
        }
      });
      return;
    }

    if (result.status === "not_promotable") {
      sendJson(response, 409, {
        error: {
          code: "ASSET_NOT_PROMOTABLE",
          message: result.reason
        }
      });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Converts URL search parameters into strict shared search filters.
 */
function readSearchFilters(url: URL): PartSearchFilters {
  return {
    cadAvailability: readCadAvailability(url.searchParams.get("cad")),
    category: url.searchParams.get("category") ?? undefined,
    lifecycleStatus: readLifecycleStatus(url.searchParams.get("lifecycleStatus")),
    manufacturerId: url.searchParams.get("manufacturerId") ?? undefined,
    packageId: url.searchParams.get("packageId") ?? undefined,
    page: readPositiveInteger(url.searchParams.get("page")),
    pageSize: readPositiveInteger(url.searchParams.get("pageSize")),
    query: url.searchParams.get("q") ?? undefined,
    sort: readPartSearchSort(url.searchParams.get("sort"))
  };
}

/**
 * Reads a URL CAD availability filter without accepting unknown strings.
 */
function readCadAvailability(value: string | null): CadAvailabilityFilter {
  if (value === "available" || value === "unavailable") {
    return value;
  }

  return "any";
}

/**
 * Reads a URL lifecycle filter without accepting unknown strings.
 */
function readLifecycleStatus(value: string | null): PartSearchFilters["lifecycleStatus"] {
  if (value === "active" || value === "not_recommended" || value === "obsolete" || value === "unknown") {
    return value;
  }

  return undefined;
}

/**
 * Reads search sort values without accepting arbitrary SQL-oriented strings.
 */
function readPartSearchSort(value: string | null): PartSearchSort | undefined {
  if (value === "mpn_asc" || value === "mpn_desc" || value === "updated_desc" || value === "trust_desc") {
    return value;
  }

  return undefined;
}

/**
 * Reads positive integer URL parameters for pagination.
 */
function readPositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

/**
 * Reads and parses a small JSON body from an incoming request.
 */
async function readJsonBody<TBody>(request: IncomingMessage): Promise<TBody | null> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as TBody;
  } catch {
    return null;
  }
}

/**
 * Checks generation request target values without trusting the JSON body.
 */
function isGenerationTargetAssetType(value: unknown): value is GenerationTargetAssetType {
  return value === "footprint" || value === "symbol" || value === "three_d_model";
}

/**
 * Checks review target values without trusting the JSON body.
 */
function isReviewTargetType(value: unknown): value is ReviewTargetType {
  return value === "asset" || value === "generation_workflow";
}

/**
 * Checks review outcome values without trusting the JSON body.
 */
function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return value === "approved" || value === "rejected" || value === "changes_requested";
}

/**
 * Starts telemetry for one HTTP response so every route can share one sendJson hook.
 */
function beginRouteTelemetry(response: ServerResponse, method: string, pathname: string): void {
  responseTelemetry.set(response, {
    method,
    operation: classifyRouteOperation(method, pathname),
    path: pathname,
    startedAt: performance.now(),
    timings: []
  });
}

/**
 * Measures one async route operation and stores the result for headers and local logs.
 */
async function timeRouteOperation<TValue>(response: ServerResponse, name: string, operation: () => Promise<TValue>, describe?: (value: TValue) => string): Promise<TValue> {
  const startedAt = performance.now();

  try {
    const value = await operation();

    addRouteTiming(response, name, performance.now() - startedAt, describe?.(value));

    return value;
  } catch (error) {
    addRouteTiming(response, name, performance.now() - startedAt, "failed");
    throw error;
  }
}

/**
 * Measures one synchronous route operation such as filtering or response projection.
 */
function timeSyncRouteOperation<TValue>(response: ServerResponse, name: string, operation: () => TValue, describe?: (value: TValue) => string): TValue {
  const startedAt = performance.now();

  try {
    const value = operation();

    addRouteTiming(response, name, performance.now() - startedAt, describe?.(value));

    return value;
  } catch (error) {
    addRouteTiming(response, name, performance.now() - startedAt, "failed");
    throw error;
  }
}

/**
 * Converts catalog query timings into route timings without exposing raw SQL.
 */
function buildQueryTimingSink(response: ServerResponse): (timing: CatalogQueryTiming) => void {
  return (timing) => {
    addRouteTiming(response, `db-${timing.name}`, timing.durationMs, `${timing.status}${timing.rowCount === null ? "" : ` ${timing.rowCount} rows`}${timing.scoped ? " scoped" : ""}`);
  };
}

/**
 * Adds a timing record if this response is currently being observed.
 */
function addRouteTiming(response: ServerResponse, name: string, durationMs: number, detail?: string): void {
  const telemetry = responseTelemetry.get(response);

  if (!telemetry) {
    return;
  }

  telemetry.timings.push({
    durationMs,
    name: sanitizeTimingName(name),
    ...(detail !== undefined ? { detail } : {})
  });
}

/**
 * Builds response headers and emits one local structured timing log.
 */
function buildTelemetryHeaders(response: ServerResponse, statusCode: number): Record<string, string> {
  const telemetry = responseTelemetry.get(response);

  if (!telemetry) {
    return {};
  }

  responseTelemetry.delete(response);

  const totalDurationMs = performance.now() - telemetry.startedAt;
  const timings = [{ durationMs: totalDurationMs, name: telemetry.operation }, ...telemetry.timings];

  if (process.env.NODE_ENV !== "test") {
    console.info(
      JSON.stringify({
        durationMs: roundDuration(totalDurationMs),
        method: telemetry.method,
        operation: telemetry.operation,
        path: telemetry.path,
        statusCode,
        timings: timings.map((timing) => ({
          detail: timing.detail,
          durationMs: roundDuration(timing.durationMs),
          name: timing.name
        }))
      })
    );
  }

  return {
    "Server-Timing": timings.map((timing) => `${timing.name};dur=${roundDuration(timing.durationMs)}`).join(", "),
    "X-EE-Operation": telemetry.operation,
    "X-EE-Operation-Duration-Ms": roundDuration(totalDurationMs).toString()
  };
}

/**
 * Classifies an HTTP route into one provider-neutral operation family.
 */
function classifyRouteOperation(method: string, pathname: string): string {
  if (method === "GET" && pathname === "/parts") return "api-search";
  if (method === "GET" && pathname === "/parts/facets") return "api-search-facets";
  if (method === "GET" && /^\/parts\/[^/]+$/u.test(pathname)) return "api-part-detail";
  if (method === "POST" && /^\/parts\/[^/]+\/generation-requests$/u.test(pathname)) return "api-generation-request";
  if (method === "POST" && /^\/parts\/[^/]+\/reviews$/u.test(pathname)) return "api-review-action";
  if (method === "POST" && /^\/parts\/[^/]+\/asset-promotions$/u.test(pathname)) return "api-promotion-action";
  if (method === "GET" && pathname === "/health") return "api-health";

  return "api-route";
}

/**
 * Keeps Server-Timing metric names within the HTTP token-safe subset.
 */
function sanitizeTimingName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/gu, "-");
}

/**
 * Rounds durations to one decimal place for stable logs and tests.
 */
function roundDuration(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Sends a JSON response with a stable content type.
 */
function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...buildTelemetryHeaders(response, statusCode)
  });
  response.end(JSON.stringify(payload, null, 2));
}

/**
 * Sends a typed catalog data envelope with optional degraded-state warnings.
 */
function sendCatalogJson<TData>(response: ServerResponse, data: TData, source: CatalogDataSource, warnings?: string[], pagination?: SearchPagination): void {
  const payload: ApiEnvelope<TData> = {
    data,
    ...(pagination ? { pagination } : {}),
    source,
    ...(warnings && warnings.length > 0 ? { warnings } : {})
  };

  sendJson(response, 200, payload);
}

/**
 * Sends explicit DB-backed generation request failures without falling back to seed data.
 */
function sendCatalogStoreError(response: ServerResponse, error: unknown): void {
  if (error instanceof CatalogStoreError) {
    sendJson(response, error.kind === "database_unavailable" ? 503 : 500, {
      error: {
        code: error.kind.toUpperCase(),
        message: error.message
      }
    });
    return;
  }

  sendJson(response, 500, {
    error: {
      code: "QUERY_FAILED",
      message: "Catalog write persistence failed."
    }
  });
}

/**
 * Dynamically loads seed data only when explicit local fallback is enabled.
 */
async function loadSeedCatalogRecords(): Promise<PartSearchRecord[]> {
  const { getAllPartRecords } = await import("@ee-library/shared/search");

  return getAllPartRecords();
}

/**
 * Dynamically loads and pages seed data only when explicit local fallback is enabled.
 */
async function loadSeedSearchRecords(filters: PartSearchFilters): Promise<{ pagination: SearchPagination; records: PartSearchRecord[] }> {
  return filterSortAndPaginatePartRecords(await loadSeedCatalogRecords(), filters);
}

if (process.env.NODE_ENV !== "test") {
  /** server starts the provider-neutral API process. */
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      console.error("Unhandled API route error.", error);
      sendJson(response, 500, { error: "Internal API error" });
    });
  });

  server.listen(port, () => {
    console.log(`EE Library API listening on http://localhost:${port}`);
  });
}
