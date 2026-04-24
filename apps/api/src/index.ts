/**
 * File header: Provides the provider-neutral HTTP API for catalog search and detail reads.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { filterPartRecords, filterSortAndPaginatePartRecords, getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { CatalogStoreError, createGenerationRequestInDatabase, createReviewInDatabase, getCatalogStoreStatus, promoteAssetForExportInDatabase, readPartDetailRecordsFromDatabase, readPartSearchFacetsFromDatabase, readPartSearchRecordsFromDatabase, updatePartIssueWorkflowInDatabase, updateSourceReconciliationInDatabase } from "./catalog-store";
import { resolveCatalogRecords, resolveCatalogSearchFacets, resolveCatalogSearchRecords } from "./catalog-resolver";
import { buildPartDetailResponse } from "./detail-response";
import { formatProviderImportFailureMessage, parseProviderImportRequest } from "./provider-import-request";
import { runProviderPartImport } from "./provider-import-runner";
import { formatProviderLookupFailureMessage, parseProviderLookupRequest } from "./provider-lookup-request";
import { runProviderPartLookup } from "./provider-lookup-runner";
import { isAuthError, readOptionalSession, requireAdmin } from "./auth";
import type { CatalogQueryTiming } from "./catalog-store";
import type {
  ApiEnvelope,
  AssetPromotionInput,
  CadAvailabilityFilter,
  CatalogDataSource,
  ConnectorClass,
  GenerationRequestCreateInput,
  GenerationTargetAssetType,
  PartApprovalStatus,
  PartIssueCode,
  PartIssueWorkflowUpdateInput,
  PartIssueWorkflowStatus,
  ProviderLookupCandidate,
  PartSearchFilters,
  PartSearchRecord,
  PartReadinessStatus,
  PartSearchSort,
  ProviderImportCreateResponse,
  ReviewActionInput,
  ReviewOutcome,
  ReviewTargetType,
  SourceReconciliationStatus,
  SourceReconciliationUpdateInput,
  SearchPagination
} from "@ee-library/shared/types";

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
  const issueWorkflowMatch = /^\/parts\/([^/]+)\/issues\/([^/]+)\/workflow$/u.exec(url.pathname);
  const sourceReconciliationMatch = /^\/parts\/([^/]+)\/source-reconciliation$/u.exec(url.pathname);

  if (request.method === "POST" && url.pathname === "/provider-lookups") {
    await handleProviderLookupCreate(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/imports/provider") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProviderImportCreate(request, response);
    return;
  }

  if (request.method === "POST" && generationRequestMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleGenerationRequestCreate(request, response, generationRequestMatch[1]);
    return;
  }

  if (request.method === "POST" && reviewActionMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleReviewActionCreate(request, response, reviewActionMatch[1]);
    return;
  }

  if (request.method === "POST" && promotionActionMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleAssetPromotionCreate(request, response, promotionActionMatch[1]);
    return;
  }

  if (request.method === "POST" && issueWorkflowMatch?.[1] && issueWorkflowMatch[2]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleIssueWorkflowUpdate(request, response, issueWorkflowMatch[1], decodeURIComponent(issueWorkflowMatch[2]));
    return;
  }

  if (request.method === "POST" && sourceReconciliationMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleSourceReconciliationUpdate(request, response, sourceReconciliationMatch[1]);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: "Only GET, provider-lookup POST, provider-import POST, generation-request POST, review POST, asset-promotion POST, issue-workflow POST, and source-reconciliation POST routes are enabled for the catalog API"
    });
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
    const filters = readSearchFilters(url);
    const catalog = await timeRouteOperation(
      response,
      "catalog-resolve-facets",
      () => resolveCatalogSearchFacets(() => readPartSearchFacetsFromDatabase(filters, { onQueryTiming: buildQueryTimingSink(response) }), () => loadSeedSearchFacets(filters)),
      (result) => (result.ok ? `${result.facets.manufacturers.length} manufacturers from ${result.source}` : result.body.error.code)
    );

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    const facets = timeSyncRouteOperation(response, "search-facets", () => catalog.facets, (result) => `${result.manufacturers.length} manufacturers`);
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
 * Handles explicit exact-match provider candidate lookup without changing normal catalog search behavior.
 */
async function handleProviderLookupCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<Record<string, unknown>>(request);

  if (!body) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_BODY",
        message: "Request body must be valid JSON."
      }
    });
    return;
  }

  const parsed = parseProviderLookupRequest(body);

  if (!parsed.ok) {
    sendJson(response, parsed.statusCode, {
      error: {
        code: parsed.code,
        message: parsed.message
      }
    });
    return;
  }

  try {
    const workerLookupRequest = {
      ...(parsed.lookupRequest.manufacturerName ? { manufacturerName: parsed.lookupRequest.manufacturerName } : {}),
      query: parsed.lookupRequest.query
    };
    const [session, databaseStatus, lookupCandidates] = await Promise.all([
      readOptionalSession(request),
      timeRouteOperation(response, "catalog-status", () => getCatalogStoreStatus(), (status) => status.label),
      timeRouteOperation(
        response,
        "provider-lookup-run",
        () => runProviderPartLookup(workerLookupRequest),
        (value) => `${value.length} candidates`
      )
    ]);
    const importAllowed = Boolean(session && session.role === "admin" && databaseStatus.connected);
    const payload: ProviderLookupCandidate[] = lookupCandidates.map((candidate) => ({
      ...candidate,
      importAllowed
    }));

    sendJson(response, 200, {
      data: payload
    });
  } catch (error) {
    sendJson(response, 422, {
      error: {
        code: "PROVIDER_LOOKUP_FAILED",
        message: formatProviderLookupFailureMessage(error)
      }
    });
  }
}

/**
 * Handles operator-facing single-part provider imports through the shared worker import path.
 */
async function handleProviderImportCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<Record<string, unknown>>(request);

  if (!body) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_BODY",
        message: "Request body must be valid JSON."
      }
    });
    return;
  }

  const parsed = parseProviderImportRequest(body);

  if (!parsed.ok) {
    sendJson(response, parsed.statusCode, {
      error: {
        code: parsed.code,
        message: parsed.message
      }
    });
    return;
  }

  try {
    const summary = await timeRouteOperation(
      response,
      "provider-import-run",
      () => runProviderPartImport(parsed.providerId, parsed.workerRequest),
      (value) => value.importStatus
    );

    if (summary.importStatus !== "imported") {
      sendJson(response, 422, {
        error: {
          code: "PROVIDER_IMPORT_INCOMPLETE",
          message: "Import did not complete."
        }
      });
      return;
    }

    const payload: ProviderImportCreateResponse = {
      importStatus: summary.importStatus,
      outcome: summary.outcome,
      partId: summary.partId,
      previousImportStatus: summary.previousImportStatus,
      providerId: summary.providerId,
      providerPartKey: summary.providerPartKey,
      requestedLookup: parsed.requestedLookup
    };

    sendCatalogJson(response, payload, "database");
  } catch (error) {
    sendJson(response, 422, {
      error: {
        code: "PROVIDER_IMPORT_FAILED",
        message: formatProviderImportFailureMessage(error)
      }
    });
  }
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
 * Handles operator workflow updates for one persisted part issue.
 */
async function handleIssueWorkflowUpdate(request: IncomingMessage, response: ServerResponse, partId: string, issueCode: string): Promise<void> {
  const body = await readJsonBody<PartIssueWorkflowUpdateInput>(request);

  if (!body || !isPartIssueCode(issueCode) || !isPartIssueWorkflowStatus(body.status)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_ISSUE_WORKFLOW",
        message: "Issue workflow updates require a supported issue code and status."
      }
    });
    return;
  }

  if (!isOptionalBodyString(body.assignedTo) || !isOptionalBodyString(body.resolutionNotes)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_ISSUE_WORKFLOW",
        message: "Issue workflow assignedTo and resolutionNotes must be strings when provided."
      }
    });
    return;
  }

  try {
    const workflowUpdateInput: PartIssueWorkflowUpdateInput = { status: body.status };
    const assignedTo = normalizeOptionalBodyString(body.assignedTo);
    const resolutionNotes = normalizeOptionalBodyString(body.resolutionNotes);

    if (assignedTo !== undefined) {
      workflowUpdateInput.assignedTo = assignedTo;
    }

    if (resolutionNotes !== undefined) {
      workflowUpdateInput.resolutionNotes = resolutionNotes;
    }

    const result = await timeRouteOperation(
      response,
      "issue-workflow-update",
      () => updatePartIssueWorkflowInDatabase(partId, issueCode, workflowUpdateInput),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Issue workflow updates require a configured database so operator state can be persisted."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "ISSUE_NOT_FOUND",
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
 * Handles operator updates for mixed-source reconciliation state.
 */
async function handleSourceReconciliationUpdate(request: IncomingMessage, response: ServerResponse, partId: string): Promise<void> {
  const body = await readJsonBody<SourceReconciliationUpdateInput>(request);

  if (!body || !isSourceReconciliationStatus(body.resolutionStatus)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_SOURCE_RECONCILIATION",
        message: "Source reconciliation updates require a supported resolutionStatus."
      }
    });
    return;
  }

  if (!isOptionalBodyString(body.preferredSourceRecordId) || !isOptionalBodyString(body.notes)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_SOURCE_RECONCILIATION",
        message: "Source reconciliation preferredSourceRecordId and notes must be strings when provided."
      }
    });
    return;
  }

  if (body.resolutionStatus === "canonical_source_selected" && !normalizeOptionalBodyString(body.preferredSourceRecordId)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_SOURCE_RECONCILIATION",
        message: "canonical_source_selected requires a preferredSourceRecordId."
      }
    });
    return;
  }

  try {
    const reconciliationUpdateInput: SourceReconciliationUpdateInput = {
      resolutionStatus: body.resolutionStatus
    };
    const notes = normalizeOptionalBodyString(body.notes);
    const preferredSourceRecordId = normalizeOptionalBodyString(body.preferredSourceRecordId);

    if (notes !== undefined) {
      reconciliationUpdateInput.notes = notes;
    }

    if (preferredSourceRecordId !== undefined) {
      reconciliationUpdateInput.preferredSourceRecordId = preferredSourceRecordId;
    }

    const result = await timeRouteOperation(
      response,
      "source-reconciliation-update",
      () => updateSourceReconciliationInDatabase(partId, reconciliationUpdateInput),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Source reconciliation updates require a configured database so operator state can be persisted."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "SOURCE_RECONCILIATION_NOT_FOUND",
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
    approvalStatus: readApprovalStatus(url.searchParams.get("approvalStatus")),
    cadAvailability: readCadAvailability(url.searchParams.get("cad")),
    category: url.searchParams.get("category") ?? undefined,
    connectorClass: readConnectorClass(url.searchParams.get("connectorClass")),
    datasheetUrl: url.searchParams.get("datasheetUrl") ?? undefined,
    lifecycleStatus: readLifecycleStatus(url.searchParams.get("lifecycleStatus")),
    manufacturerId: url.searchParams.get("manufacturerId") ?? undefined,
    packageId: url.searchParams.get("packageId") ?? undefined,
    page: readPositiveInteger(url.searchParams.get("page")),
    pageSize: readPositiveInteger(url.searchParams.get("pageSize")),
    providerPartId: url.searchParams.get("providerPartId") ?? undefined,
    providerUrl: url.searchParams.get("providerUrl") ?? undefined,
    query: url.searchParams.get("q") ?? undefined,
    readinessStatus: readReadinessStatus(url.searchParams.get("readinessStatus")),
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
 * Reads part readiness filters without accepting unknown strings.
 */
function readReadinessStatus(value: string | null): PartReadinessStatus | undefined {
  if (value === "ready_for_export_review" || value === "needs_attention" || value === "blocked" || value === "unknown") {
    return value;
  }

  return undefined;
}

/**
 * Reads part approval filters without accepting unknown strings.
 */
function readApprovalStatus(value: string | null): PartApprovalStatus | undefined {
  if (value === "approved" || value === "pending_review" || value === "not_requested" || value === "not_applicable") {
    return value;
  }

  return undefined;
}

/**
 * Reads connector class filters without accepting unknown strings.
 */
function readConnectorClass(value: string | null): ConnectorClass | undefined {
  if (value === "connector" || value === "accessory" || value === "tooling" || value === "cable" || value === "non_connector") {
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
 * Checks part issue codes without trusting path segments.
 */
function isPartIssueCode(value: unknown): value is PartIssueCode {
  return value === "low_confidence_identity" ||
    value === "pending_approval" ||
    value === "missing_verified_cad" ||
    value === "missing_datasheet" ||
    value === "missing_connector_mate" ||
    value === "missing_connector_accessories" ||
    value === "connector_low_confidence" ||
    value === "lifecycle_risk" ||
    value === "source_conflict" ||
    value === "duplicate_candidate";
}

/**
 * Checks issue workflow state values without trusting request JSON.
 */
function isPartIssueWorkflowStatus(value: unknown): value is PartIssueWorkflowStatus {
  return value === "open" || value === "in_review" || value === "resolved" || value === "ignored";
}

/**
 * Checks source reconciliation status values without trusting request JSON.
 */
function isSourceReconciliationStatus(value: unknown): value is SourceReconciliationStatus {
  return value === "unreviewed" || value === "canonical_source_selected" || value === "mixed_sources_accepted";
}

/**
 * Checks optional body strings so routes can reject unexpected object or array values.
 */
function isOptionalBodyString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Normalizes optional body strings so empty text does not persist as fake values.
 */
function normalizeOptionalBodyString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return value.trim().length > 0 ? value.trim() : null;
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
  if (method === "POST" && pathname === "/provider-lookups") return "api-provider-lookup";
  if (method === "POST" && /^\/parts\/[^/]+\/generation-requests$/u.test(pathname)) return "api-generation-request";
  if (method === "POST" && /^\/parts\/[^/]+\/reviews$/u.test(pathname)) return "api-review-action";
  if (method === "POST" && /^\/parts\/[^/]+\/asset-promotions$/u.test(pathname)) return "api-promotion-action";
  if (method === "POST" && /^\/parts\/[^/]+\/issues\/[^/]+\/workflow$/u.test(pathname)) return "api-issue-workflow";
  if (method === "POST" && /^\/parts\/[^/]+\/source-reconciliation$/u.test(pathname)) return "api-source-reconciliation";
  if (method === "POST" && pathname === "/imports/provider") return "api-provider-import";
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

/**
 * Dynamically loads and filters seed facets only when explicit local fallback is enabled.
 */
async function loadSeedSearchFacets(filters: PartSearchFilters): Promise<ReturnType<typeof getSearchFacetsFromRecords>> {
  const filteredRecords = filterPartRecords(await loadSeedCatalogRecords(), filters);

  return getSearchFacetsFromRecords(filteredRecords);
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
