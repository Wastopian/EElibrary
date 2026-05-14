/**
 * File header: Provides the provider-neutral HTTP API for catalog search and detail reads.
 */

import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { extname, basename } from "node:path";
import { performance } from "node:perf_hooks";
import { BomCsvParseError, buildBomImportPreview } from "@ee-library/shared/bom-csv";
import { filterPartRecords, filterSortAndPaginatePartRecords, getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { parseConnectorSetIntentText, resolveConnectorSetIntent } from "@ee-library/shared/connector-intelligence";
import { resolveStorageKey } from "@ee-library/shared/file-storage";
import { CatalogStoreError, createGenerationRequestInDatabase, createProviderAcquisitionJobInDatabase, createReviewInDatabase, getCatalogStoreStatus, promoteAssetForExportInDatabase, readAssetDownloadTargetFromDatabase, readCatalogRecordsFromDatabase, readPartAcquisitionSummaryFromDatabase, readPartDetailRecordsFromDatabase, readPartEnrichmentSummaryFromDatabase, readPartSearchFacetsFromDatabase, readPartSearchRecordsFromDatabase, readProviderAcquisitionJobInDatabase, updatePartIssueWorkflowInDatabase, updateSourceReconciliationInDatabase } from "./catalog-store";
import { resolveCatalogRecords, resolveCatalogSearchFacets, resolveCatalogSearchRecords } from "./catalog-resolver";
import { buildPartDetailResponse, buildUnavailablePartAcquisitionSummary, buildUnavailablePartEnrichmentSummary } from "./detail-response";
import { parseProviderAcquisitionJobCreateRequest } from "./provider-acquisition-request";
import { formatProviderImportFailureMessage, parseProviderImportRequest } from "./provider-import-request";
import { runProviderPartImport } from "./provider-import-runner";
import { formatProviderLookupFailureMessage, parseProviderLookupRequest } from "./provider-lookup-request";
import { runProviderPartLookup } from "./provider-lookup-runner";
import { getStorageClient } from "./file-storage";
import { buildProjectFilesResponse, resolveProjectFolderCategory, saveProjectFile } from "./project-files";
import { buildVendorDetailResponse, buildVendorListResponse, createVendor, resolveVendorFolderSection, saveVendorFile } from "./vendors";
import { assertAuthSecretConfigured, isAuthError, readOptionalSession, readSessionFromRequest, requireAdmin } from "./auth";
import { buildSystemHealth } from "./system-health";
import { createAuditEventInDatabase, readAuditEventsFromDatabase } from "./audit-log";
import type { AuditEventListFilters } from "./audit-log";
import { createDocumentRedlineInDatabase, createDocumentRevisionInDatabase, readAssetDownloadAclGrant, readAssetDownloadGateFromDatabase, readDocumentRevisionsForPartFromDatabase, updateDocumentRedlineInDatabase } from "./document-control";
import type { AssetDownloadGrant } from "./document-control";
import { readPartSupplyOffersFromDatabase } from "./supply-offers";
import { applyApprovalBatchInDatabase, createBomImportInDatabase, createCircuitBlockInDatabase, createCircuitBlockKnownRiskInDatabase, createCircuitBlockPartInDatabase, createEvidenceAttachmentInDatabase, createExportBundleInDatabase, createPartSubstitutionInDatabase, createProjectInDatabase, instantiateCircuitBlockIntoProjectBomInDatabase, resolveCircuitBlockKnownRiskInDatabase, matchBomImportRowsInDatabase, readApprovalBatchCandidatesFromDatabase, readBomImportDiagnosticsFromDatabase, readBomImportLinesFromDatabase, readBomRevisionCompareFromDatabase, readCircuitBlockDetailFromDatabase, readCircuitBlockFollowUpsFromDatabase, readCircuitBlockProjectDependenciesFromDatabase, readCircuitBlocksFromDatabase, readConnectorSetCatalogFromDatabase, readEvidenceAttachmentsFromDatabase, readExportBundlesFromDatabase, readPartSubstitutionsForPartFromDatabase, readPartWhereUsedFromDatabase, readProjectBomHealthFromDatabase, readProjectBomImportsFromDatabase, readProjectDetailFromDatabase, readProjectEvidenceAttachmentsFromDatabase, readProjectFleetRiskFromDatabase, readProjectFollowUpsFromDatabase, readProjectPartUsagesFromDatabase, readProjectRevisionApprovalGatesFromDatabase, readProjectRevisionCompareFromDatabase, readProjectRevisionsFromDatabase, readProjectsFromDatabase, readWhereUsedSearchFromDatabase, revokePartSubstitutionInDatabase, syncCircuitBlockFollowUpsFromReadinessInDatabase, syncProjectFollowUpsFromBomHealthInDatabase, updateCircuitBlockInDatabase, updateCircuitBlockPartInDatabase, updateEvidenceAttachmentInDatabase, updateFollowUpInDatabase, updateProjectInDatabase, updateProjectRevisionInDatabase, upsertProjectRevisionApprovalGateInDatabase } from "./project-memory-store";
import type { CatalogQueryTiming } from "./catalog-store";
import type {
  ApiEnvelope,
  ApprovalBatchAction,
  ApprovalBatchRequest,
  AuditEventMetadata,
  AuditEventTargetType,
  AssetPromotionInput,
  BomImportCreateInput,
  BomImportPreviewInput,
  CadAvailabilityFilter,
  CatalogDataSource,
  CircuitBlockCreateInput,
  CircuitBlockInstantiationCreateInput,
  CircuitBlockKnownRiskCreateInput,
  CircuitBlockKnownRiskResolveInput,
  CircuitBlockKnownRiskSeverity,
  CircuitBlockListFilters,
  CircuitBlockPartCreateInput,
  CircuitBlockPartSubstitutionPolicy,
  CircuitBlockPartUpdateInput,
  CircuitBlockReuseReadinessFilter,
  CircuitBlockStatus,
  CircuitBlockType,
  CircuitBlockUpdateInput,
  ConnectorClass,
  ConnectorSetIntentInput,
  DocumentAccessLevel,
  DocumentAclPermission,
  DocumentAclPrincipalType,
  DocumentControlType,
  DocumentRedlineCreateInput,
  DocumentRedlineSeverity,
  DocumentRedlineStatus,
  DocumentRedlineUpdateInput,
  DocumentRevisionCreateInput,
  DocumentRevisionLifecycleStatus,
  EvidenceAttachmentCreateInput,
  EvidenceAttachmentFileUploadInput,
  EvidenceAttachmentListFilters,
  EvidenceAttachmentType,
  EvidenceAttachmentUpdateInput,
  EvidenceReviewStatus,
  EvidenceStorageState,
  EvidenceTargetType,
  ExportBundleCreateInput,
  ExportBundleFormat,
  FollowUpStatus,
  FollowUpUpdateInput,
  GenerationRequestCreateInput,
  GenerationTargetAssetType,
  PartApprovalStatus,
  PartIssueCode,
  PartIssueWorkflowUpdateInput,
  PartIssueWorkflowStatus,
  ProviderAcquisitionJobDetailResponse,
  ProviderLookupCandidate,
  PartSearchFilters,
  PartSearchRecord,
  PartReadinessStatus,
  PartSearchSort,
  PartSubstitutionCreateInput,
  ProjectCreateInput,
  ProjectFileUploadInput,
  ProjectRevisionApprovalGateRequest,
  VendorCreateInput,
  VendorFileUploadInput,
  ProjectRevisionStatus,
  ProjectRevisionUpdateInput,
  ProjectStatus,
  ProjectUpdateInput,
  ProviderImportCreateResponse,
  ReviewActionInput,
  ReviewOutcome,
  ReviewTargetType,
  SourceReconciliationStatus,
  SourceReconciliationUpdateInput,
  SearchPagination,
  WhereUsedTargetType
} from "@ee-library/shared/types";

/** port is the local HTTP port for the API process. */
const port = Number(process.env.API_PORT ?? 4000);

/** maxBomCsvBytes bounds MVP JSON upload size before row matching moves into worker-backed intake. */
const maxBomCsvBytes = 2 * 1024 * 1024;

/** maxEvidenceUploadBytes bounds local evidence uploads accepted through JSON base64 MVP transport. */
const maxEvidenceUploadBytes = 8 * 1024 * 1024;

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

/** RequestAuditContext carries a request id until the middleware writes an audit event. */
interface RequestAuditContext {
  /** Stable request id returned in headers and persisted to audit_events. */
  requestId: string;
}

/** AuditRouteDescriptor is the route-level target/action classification saved for unsafe methods. */
interface AuditRouteDescriptor {
  /** Provider-neutral action label, usually derived from the API operation. */
  action: string;
  /** Broad target family for future RBAC and ECO policies. */
  targetType: AuditEventTargetType;
  /** Best-effort target id from route params, without reading request bodies. */
  targetId: string | null;
}

/** responseTelemetry carries request timing state until sendJson writes the response. */
const responseTelemetry = new WeakMap<ServerResponse, RouteTelemetry>();

/** requestAuditContexts carries immutable request ids until the audit middleware flushes. */
const requestAuditContexts = new WeakMap<ServerResponse, RequestAuditContext>();

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
  beginRequestAuditContext(response, request);
  const generationRequestMatch = /^\/parts\/([^/]+)\/generation-requests$/u.exec(url.pathname);
  const providerAcquisitionJobMatch = /^\/provider-acquisition-jobs\/([^/]+)$/u.exec(url.pathname);
  const auditEventsMatch = /^\/audit-events$/u.exec(url.pathname);
  const promotionActionMatch = /^\/parts\/([^/]+)\/asset-promotions$/u.exec(url.pathname);
  const reviewActionMatch = /^\/parts\/([^/]+)\/reviews$/u.exec(url.pathname);
  const partDocumentRevisionsMatch = /^\/parts\/([^/]+)\/document-revisions$/u.exec(url.pathname);
  const documentRevisionRedlinesMatch = /^\/document-revisions\/([^/]+)\/redlines$/u.exec(url.pathname);
  const documentRedlineDetailMatch = /^\/document-redlines\/([^/]+)$/u.exec(url.pathname);
  const issueWorkflowMatch = /^\/parts\/([^/]+)\/issues\/([^/]+)\/workflow$/u.exec(url.pathname);
  const sourceReconciliationMatch = /^\/parts\/([^/]+)\/source-reconciliation$/u.exec(url.pathname);
  const assetDownloadMatch = /^\/parts\/([^/]+)\/assets\/([^/]+)\/download$/u.exec(url.pathname);
  const projectRevisionsMatch = /^\/projects\/([^/]+)\/revisions$/u.exec(url.pathname);
  const projectRevisionCompareMatch = /^\/projects\/([^/]+)\/revisions\/compare$/u.exec(url.pathname);
  const projectRevisionApprovalGatesMatch = /^\/projects\/([^/]+)\/revision-approval-gates$/u.exec(url.pathname);
  const projectRevisionDetailMatch = /^\/projects\/([^/]+)\/revisions\/([^/]+)$/u.exec(url.pathname);
  const projectBomImportsMatch = /^\/projects\/([^/]+)\/bom-imports$/u.exec(url.pathname);
  const projectUsagesMatch = /^\/projects\/([^/]+)\/usages$/u.exec(url.pathname);
  const projectBomHealthMatch = /^\/projects\/([^/]+)\/bom-health$/u.exec(url.pathname);
  const projectEvidenceMatch = /^\/projects\/([^/]+)\/evidence$/u.exec(url.pathname);
  const projectFollowUpsMatch = /^\/projects\/([^/]+)\/follow-ups$/u.exec(url.pathname);
  const projectFilesMatch = /^\/projects\/([^/]+)\/files$/u.exec(url.pathname);
  const projectFileUploadMatch = /^\/projects\/([^/]+)\/files\/([^/]+)$/u.exec(url.pathname);
  const projectDetailMatch = /^\/projects\/([^/]+)$/u.exec(url.pathname);
  const circuitBlockPartCreateMatch = /^\/circuit-blocks\/([^/]+)\/parts$/u.exec(url.pathname);
  const circuitBlockPartUpdateMatch = /^\/circuit-blocks\/([^/]+)\/parts\/([^/]+)$/u.exec(url.pathname);
  const circuitBlockKnownRiskCreateMatch = /^\/circuit-blocks\/([^/]+)\/known-risks$/u.exec(url.pathname);
  const circuitBlockKnownRiskResolveMatch = /^\/circuit-blocks\/([^/]+)\/known-risks\/([^/]+)\/resolve$/u.exec(url.pathname);
  const circuitBlockFollowUpsMatch = /^\/circuit-blocks\/([^/]+)\/follow-ups$/u.exec(url.pathname);
  const circuitBlockProjectDepsMatch = /^\/circuit-blocks\/([^/]+)\/project-dependencies$/u.exec(url.pathname);
  const circuitBlockDetailMatch = /^\/circuit-blocks\/([^/]+)$/u.exec(url.pathname);
  const evidenceAttachmentDetailMatch = /^\/evidence-attachments\/([^/]+)$/u.exec(url.pathname);
  const followUpDetailMatch = /^\/follow-ups\/([^/]+)$/u.exec(url.pathname);
  const bomImportLinesMatch = /^\/bom-imports\/([^/]+)\/lines$/u.exec(url.pathname);
  const bomImportMatchMatch = /^\/bom-imports\/([^/]+)\/match$/u.exec(url.pathname);
  const bomImportDiagnosticsMatch = /^\/bom-imports\/([^/]+)\/diagnostics$/u.exec(url.pathname);
  const partUsagesMatch = /^\/parts\/([^/]+)\/usages$/u.exec(url.pathname);
  const partSupplyOffersMatch = /^\/parts\/([^/]+)\/supply-offers$/u.exec(url.pathname);
  const partSubstitutionsMatch = /^\/parts\/([^/]+)\/substitutions$/u.exec(url.pathname);
  const substitutionRevokeMatch = /^\/substitutions\/([^/]+)\/revoke$/u.exec(url.pathname);
  const projectExportBundlesMatch = /^\/projects\/([^/]+)\/export-bundles$/u.exec(url.pathname);
  const projectCircuitBlockInstantiationsMatch = /^\/projects\/([^/]+)\/circuit-block-instantiations$/u.exec(url.pathname);
  const projectApprovalBatchMatch = /^\/projects\/([^/]+)\/approval-batch$/u.exec(url.pathname);
  const projectApprovalCandidatesMatch = /^\/projects\/([^/]+)\/approval-candidates$/u.exec(url.pathname);
  const storageServeMatch = /^\/storage\/(.+)$/u.exec(url.pathname);
  const vendorDetailMatch = /^\/vendors\/([^/]+)$/u.exec(url.pathname);
  const vendorFileUploadMatch = /^\/vendors\/([^/]+)\/files\/([^/]+)$/u.exec(url.pathname);

  try {
  if (request.method === "POST" && url.pathname === "/provider-lookups") {
    await handleProviderLookupCreate(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/projects") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectCreate(request, response);
    return;
  }

  if (request.method === "PATCH" && projectRevisionDetailMatch?.[1] && projectRevisionDetailMatch[2]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectRevisionUpdate(request, response, decodeURIComponent(projectRevisionDetailMatch[1]), decodeURIComponent(projectRevisionDetailMatch[2]));
    return;
  }

  if (request.method === "PATCH" && projectDetailMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectUpdate(request, response, decodeURIComponent(projectDetailMatch[1]));
    return;
  }

  if (request.method === "POST" && url.pathname === "/bom-imports/preview") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleBomImportPreview(request, response);
    return;
  }

  if (request.method === "POST" && projectBomImportsMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectBomImportCreate(request, response, decodeURIComponent(projectBomImportsMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && bomImportMatchMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleBomImportMatch(response, decodeURIComponent(bomImportMatchMatch[1]));
    return;
  }

  if (request.method === "POST" && url.pathname === "/evidence-attachments") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleEvidenceAttachmentCreate(request, response, session.sub);
    return;
  }

  if (request.method === "POST" && url.pathname === "/evidence-attachments/files") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleEvidenceAttachmentFileUpload(request, response, session.sub);
    return;
  }

  if (request.method === "PATCH" && evidenceAttachmentDetailMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleEvidenceAttachmentUpdate(request, response, decodeURIComponent(evidenceAttachmentDetailMatch[1]));
    return;
  }

  if (request.method === "POST" && projectFollowUpsMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectFollowUpsSync(response, decodeURIComponent(projectFollowUpsMatch[1]));
    return;
  }

  if (request.method === "POST" && projectFileUploadMatch?.[1] && projectFileUploadMatch[2]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectFileUpload(
      request,
      response,
      decodeURIComponent(projectFileUploadMatch[1]),
      decodeURIComponent(projectFileUploadMatch[2])
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/vendors") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleVendorCreate(request, response);
    return;
  }

  if (request.method === "POST" && vendorFileUploadMatch?.[1] && vendorFileUploadMatch[2]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleVendorFileUpload(
      request,
      response,
      decodeURIComponent(vendorFileUploadMatch[1]),
      decodeURIComponent(vendorFileUploadMatch[2])
    );
    return;
  }

  if (request.method === "POST" && circuitBlockFollowUpsMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockFollowUpsSync(response, decodeURIComponent(circuitBlockFollowUpsMatch[1]));
    return;
  }

  if (request.method === "PATCH" && followUpDetailMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleFollowUpUpdate(request, response, decodeURIComponent(followUpDetailMatch[1]));
    return;
  }

  if (request.method === "POST" && url.pathname === "/circuit-blocks") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockCreate(request, response);
    return;
  }

  if (request.method === "PATCH" && circuitBlockPartUpdateMatch?.[1] && circuitBlockPartUpdateMatch[2]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockPartUpdate(request, response, decodeURIComponent(circuitBlockPartUpdateMatch[1]), decodeURIComponent(circuitBlockPartUpdateMatch[2]));
    return;
  }

  if (request.method === "PATCH" && circuitBlockDetailMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockUpdate(request, response, decodeURIComponent(circuitBlockDetailMatch[1]));
    return;
  }

  if (request.method === "POST" && circuitBlockPartCreateMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockPartCreate(request, response, decodeURIComponent(circuitBlockPartCreateMatch[1]));
    return;
  }

  if (request.method === "POST" && circuitBlockKnownRiskCreateMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockKnownRiskCreate(request, response, decodeURIComponent(circuitBlockKnownRiskCreateMatch[1]));
    return;
  }

  if (request.method === "POST" && circuitBlockKnownRiskResolveMatch?.[1] && circuitBlockKnownRiskResolveMatch?.[2]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockKnownRiskResolve(
      request,
      response,
      decodeURIComponent(circuitBlockKnownRiskResolveMatch[1]),
      decodeURIComponent(circuitBlockKnownRiskResolveMatch[2])
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/imports/provider") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProviderImportCreate(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/provider-acquisition-jobs") {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProviderAcquisitionJobCreate(request, response, session.sub);
    return;
  }

  if (request.method === "GET" && providerAcquisitionJobMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProviderAcquisitionJobRead(response, decodeURIComponent(providerAcquisitionJobMatch[1]));
    return;
  }

  if (request.method === "POST" && generationRequestMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleGenerationRequestCreate(request, response, generationRequestMatch[1]);
    return;
  }

  if (request.method === "POST" && partDocumentRevisionsMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleDocumentRevisionCreate(request, response, decodeURIComponent(partDocumentRevisionsMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && documentRevisionRedlinesMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleDocumentRedlineCreate(request, response, decodeURIComponent(documentRevisionRedlinesMatch[1]), session.sub);
    return;
  }

  if (request.method === "PATCH" && documentRedlineDetailMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleDocumentRedlineUpdate(request, response, decodeURIComponent(documentRedlineDetailMatch[1]), session.sub);
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

  if (request.method === "POST" && projectExportBundlesMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleExportBundleCreate(request, response, decodeURIComponent(projectExportBundlesMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && projectCircuitBlockInstantiationsMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleCircuitBlockInstantiationCreate(request, response, decodeURIComponent(projectCircuitBlockInstantiationsMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && partSubstitutionsMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handlePartSubstitutionCreate(request, response, decodeURIComponent(partSubstitutionsMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && projectApprovalBatchMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleApprovalBatchApply(request, response, decodeURIComponent(projectApprovalBatchMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && projectRevisionApprovalGatesMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleProjectRevisionApprovalGateApply(request, response, decodeURIComponent(projectRevisionApprovalGatesMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && substitutionRevokeMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handlePartSubstitutionRevoke(response, decodeURIComponent(substitutionRevokeMatch[1]), session.sub);
    return;
  }

  if (request.method === "POST" && url.pathname === "/connector-sets/resolve") {
    await handleConnectorSetIntentResolve(request, response);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: "Only GET, project POST/PATCH, project revision PATCH, project revision approval gate POST, BOM preview/import/match POST, evidence attachment POST/PATCH, follow-up POST/PATCH, circuit-block POST/PATCH, circuit-block part POST/PATCH, document-control POST/PATCH, provider-lookup POST, provider-import POST, provider-acquisition-job POST, generation-request POST, review POST, asset-promotion POST, issue-workflow POST, source-reconciliation POST, export-bundle POST, and approval-batch POST routes are enabled for the catalog API"
    });
    return;
  }

  if (url.pathname === "/health") {
    const database = await timeRouteOperation(response, "catalog-status", () => getCatalogStoreStatus(), (status) => status.label);

    sendJson(response, 200, {
      dependencies: {
        database: database.label,
        objectStorage: getStorageClient().backend,
        queue: "not_connected_phase_0"
      },
      service: "api",
      status: "ok"
    });
    return;
  }

  if (url.pathname === "/system/health") {
    const health = await timeRouteOperation(
      response,
      "system-health",
      () => buildSystemHealth(),
      (payload) => `database=${payload.database.status} worker=${payload.worker.status}`
    );

    sendJson(response, 200, health);
    return;
  }

  if (request.method === "GET" && auditEventsMatch) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleAuditEventsRead(response, url);
    return;
  }

  if (url.pathname === "/where-used") {
    await handleWhereUsedSearchRead(response, url);
    return;
  }

  if (url.pathname === "/connector-sets") {
    await handleConnectorSetCatalogRead(response, url);
    return;
  }

  if (url.pathname === "/evidence-attachments") {
    await handleEvidenceAttachmentsRead(response, url);
    return;
  }

  if (url.pathname === "/projects") {
    await handleProjectListRead(response);
    return;
  }

  if (url.pathname === "/projects/health-summary") {
    await handleProjectFleetRiskRead(response);
    return;
  }

  if (url.pathname === "/circuit-blocks") {
    await handleCircuitBlockListRead(response, url);
    return;
  }

  if (circuitBlockDetailMatch?.[1]) {
    await handleCircuitBlockDetailRead(response, decodeURIComponent(circuitBlockDetailMatch[1]));
    return;
  }

  if (projectRevisionCompareMatch?.[1]) {
    await handleProjectRevisionCompareRead(response, decodeURIComponent(projectRevisionCompareMatch[1]), url);
    return;
  }

  if (projectRevisionApprovalGatesMatch?.[1]) {
    await handleProjectRevisionApprovalGatesRead(response, decodeURIComponent(projectRevisionApprovalGatesMatch[1]));
    return;
  }

  if (projectRevisionsMatch?.[1]) {
    await handleProjectRevisionsRead(response, decodeURIComponent(projectRevisionsMatch[1]));
    return;
  }

  if (projectBomImportsMatch?.[1]) {
    await handleProjectBomImportsRead(response, decodeURIComponent(projectBomImportsMatch[1]));
    return;
  }

  if (projectUsagesMatch?.[1]) {
    await handleProjectPartUsagesRead(response, decodeURIComponent(projectUsagesMatch[1]));
    return;
  }

  if (projectBomHealthMatch?.[1]) {
    await handleProjectBomHealthRead(response, decodeURIComponent(projectBomHealthMatch[1]));
    return;
  }

  if (projectExportBundlesMatch?.[1]) {
    await handleExportBundlesRead(response, decodeURIComponent(projectExportBundlesMatch[1]));
    return;
  }

  if (projectApprovalCandidatesMatch?.[1]) {
    await handleApprovalBatchCandidatesRead(response, decodeURIComponent(projectApprovalCandidatesMatch[1]));
    return;
  }

  if (projectEvidenceMatch?.[1]) {
    await handleProjectEvidenceAttachmentsRead(response, decodeURIComponent(projectEvidenceMatch[1]));
    return;
  }

  if (projectFollowUpsMatch?.[1]) {
    await handleProjectFollowUpsRead(response, decodeURIComponent(projectFollowUpsMatch[1]));
    return;
  }

  if (projectFilesMatch?.[1]) {
    await handleProjectFilesRead(response, decodeURIComponent(projectFilesMatch[1]));
    return;
  }

  if (request.method === "GET" && url.pathname === "/vendors") {
    await handleVendorListRead(response);
    return;
  }

  if (request.method === "GET" && vendorDetailMatch?.[1]) {
    await handleVendorDetailRead(response, decodeURIComponent(vendorDetailMatch[1]));
    return;
  }

  if (circuitBlockFollowUpsMatch?.[1]) {
    await handleCircuitBlockFollowUpsRead(response, decodeURIComponent(circuitBlockFollowUpsMatch[1]));
    return;
  }

  if (circuitBlockProjectDepsMatch?.[1]) {
    await handleCircuitBlockProjectDependenciesRead(response, decodeURIComponent(circuitBlockProjectDepsMatch[1]));
    return;
  }

  if (projectDetailMatch?.[1]) {
    await handleProjectDetailRead(response, decodeURIComponent(projectDetailMatch[1]));
    return;
  }

  if (bomImportLinesMatch?.[1]) {
    await handleBomImportLinesRead(response, decodeURIComponent(bomImportLinesMatch[1]));
    return;
  }

  if (bomImportDiagnosticsMatch?.[1]) {
    await handleBomImportDiagnosticsRead(response, decodeURIComponent(bomImportDiagnosticsMatch[1]));
    return;
  }

  if (url.pathname === "/bom-compare") {
    await handleBomRevisionCompareRead(response, url);
    return;
  }

  if (storageServeMatch?.[1]) {
    const session = await requireAdmin(request);
    if (isAuthError(session)) { sendJson(response, session.statusCode, { error: { code: session.code, message: session.message } }); return; }
    await handleStorageFileServe(response, storageServeMatch[1]);
    return;
  }

  if (partUsagesMatch?.[1]) {
    await handlePartWhereUsedRead(response, decodeURIComponent(partUsagesMatch[1]));
    return;
  }

  if (partDocumentRevisionsMatch?.[1]) {
    await handlePartDocumentRevisionsRead(response, decodeURIComponent(partDocumentRevisionsMatch[1]));
    return;
  }

  if (partSupplyOffersMatch?.[1]) {
    await handlePartSupplyOffersRead(response, decodeURIComponent(partSupplyOffersMatch[1]));
    return;
  }

  if (partSubstitutionsMatch?.[1]) {
    await handlePartSubstitutionsRead(response, decodeURIComponent(partSubstitutionsMatch[1]));
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

  if (assetDownloadMatch?.[1] && assetDownloadMatch[2]) {
    await handleAssetDownload(request, response, decodeURIComponent(assetDownloadMatch[1]), decodeURIComponent(assetDownloadMatch[2]), url);
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

    const acquisitionSummary = catalog.source === "database"
      ? await timeRouteOperation(
          response,
          "detail-acquisition-read",
          () => readPartAcquisitionSummaryFromDatabase(partId, { onQueryTiming: buildQueryTimingSink(response) }),
          (result) => result.state
        )
      : buildUnavailablePartAcquisitionSummary("Acquisition history is unavailable while this part detail is being served from seed fallback data.");
    const enrichmentSummary = catalog.source === "database"
      ? await timeRouteOperation(
          response,
          "detail-enrichment-read",
          () => readPartEnrichmentSummaryFromDatabase(partId, { onQueryTiming: buildQueryTimingSink(response) }),
          (result) => result.state
        )
      : buildUnavailablePartEnrichmentSummary("Enrichment history is unavailable while this part detail is being served from seed fallback data.");
    const detailResponse = timeSyncRouteOperation(
      response,
      "detail-build",
      () => buildPartDetailResponse(record, records, acquisitionSummary, enrichmentSummary),
      (result) => `${result.relatedPartSummaries.length} related summaries`
    );

    sendCatalogJson(response, detailResponse, catalog.source, catalog.warnings);
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
  } finally {
    await flushRequestAuditEvent(request, response, url);
  }
}

/**
 * Handles admin-only audit event reads for security review.
 * Optional filters (actorId / action / targetType / targetId / outcome / time window)
 * narrow the timeline so the admin can do per-actor or per-entity audit queries.
 */
async function handleAuditEventsRead(response: ServerResponse, url: URL): Promise<void> {
  try {
    const limit = readAuditEventLimit(url.searchParams.get("limit"));
    const filters = readAuditEventFilters(url.searchParams);
    const result = await timeRouteOperation(
      response,
      "audit-events-read",
      () => readAuditEventsFromDatabase(limit, filters),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendAuditLogNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Reads optional audit query filters from URL search params and narrows untrusted
 * outcome strings to the typed union so a bad value cannot reach the SQL layer.
 */
function readAuditEventFilters(searchParams: URLSearchParams): AuditEventListFilters {
  const filters: AuditEventListFilters = {};
  const actorId = searchParams.get("actorId");
  const action = searchParams.get("action");
  const targetType = searchParams.get("targetType");
  const targetId = searchParams.get("targetId");
  const outcome = searchParams.get("outcome");
  const occurredSince = searchParams.get("occurredSince");
  const occurredUntil = searchParams.get("occurredUntil");

  if (actorId) filters.actorId = actorId;
  if (action) filters.action = action;
  if (targetType) filters.targetType = targetType;
  if (targetId) filters.targetId = targetId;
  if (outcome === "succeeded" || outcome === "failed" || outcome === "denied") {
    filters.outcome = outcome;
  }
  if (occurredSince) filters.occurredSince = occurredSince;
  if (occurredUntil) filters.occurredUntil = occurredUntil;

  return filters;
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
 * Handles admin-gated provider acquisition job creation from one selected exact-match candidate.
 */
async function handleProviderAcquisitionJobCreate(request: IncomingMessage, response: ServerResponse, requestedBy: string): Promise<void> {
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

  const parsed = parseProviderAcquisitionJobCreateRequest(body);

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
    const result = await timeRouteOperation(
      response,
      "provider-acquisition-job-create",
      () => createProviderAcquisitionJobInDatabase(parsed.jobInput, requestedBy),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Provider acquisition jobs require a configured catalog database so queue state can be persisted."
        }
      });
      return;
    }

    sendCatalogJsonWithStatus<ProviderAcquisitionJobDetailResponse>(response, 202, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles admin-gated provider acquisition job reads for client polling and operator status checks.
 */
async function handleProviderAcquisitionJobRead(response: ServerResponse, jobId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "provider-acquisition-job-read",
      () => readProviderAcquisitionJobInDatabase(jobId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Provider acquisition jobs require a configured catalog database so queue state can be read."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "PROVIDER_ACQUISITION_JOB_NOT_FOUND",
          message: "Provider acquisition job not found."
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
 * Handles project creation so the web app can open a real project-memory workspace.
 */
async function handleProjectCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<ProjectCreateInput>(request);

  if (!body || !isProjectCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_PROJECT_CREATE_REQUEST",
        message: "Project creation requires projectKey and name."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "project-create", () => createProjectInDatabase(body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "conflict") {
      sendJson(response, 409, {
        error: {
          code: "PROJECT_KEY_CONFLICT",
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles project metadata edits without changing BOM, evidence, approval, or export records.
 */
async function handleProjectUpdate(request: IncomingMessage, response: ServerResponse, projectId: string): Promise<void> {
  const body = await readJsonBody<ProjectUpdateInput>(request);

  if (!body || !isProjectUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_PROJECT_UPDATE",
        message: "Project update requires name and supported status."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "project-update", () => updateProjectInDatabase(projectId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles project revision metadata edits while keeping BOM rows and usage history unchanged.
 */
async function handleProjectRevisionUpdate(request: IncomingMessage, response: ServerResponse, projectId: string, revisionId: string): Promise<void> {
  const body = await readJsonBody<ProjectRevisionUpdateInput>(request);

  if (!body || !isProjectRevisionUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_PROJECT_REVISION_UPDATE",
        message: "Project revision update requires a supported revision status."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "project-revision-update", () => updateProjectRevisionInDatabase(projectId, revisionId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles no-write BOM CSV preview requests for the mapping UI.
 */
async function handleBomImportPreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<BomImportPreviewInput>(request);

  if (!body || !isBomImportPreviewInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_BOM_PREVIEW_REQUEST",
        message: "BOM preview requires a CSV filename and rawContent."
      }
    });
    return;
  }

  try {
    const preview = timeSyncRouteOperation(response, "bom-import-preview", () => buildBomImportPreview(body), (value) => `${value.rowCount} rows`);

    sendCatalogJson(response, preview, "database");
  } catch (error) {
    if (error instanceof BomCsvParseError) {
      sendJson(response, 400, {
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles mapped BOM CSV persistence for one project without running part matching.
 */
async function handleProjectBomImportCreate(request: IncomingMessage, response: ServerResponse, projectId: string, importedBy: string): Promise<void> {
  const body = await readJsonBody<BomImportCreateInput>(request);

  if (!body || !isBomImportCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_BOM_IMPORT_REQUEST",
        message: "BOM import requires a CSV filename, rawContent, and columnMapping."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "bom-import-create", () => createBomImportInDatabase(projectId, body, importedBy), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles internal BOM row matching and confirmed usage creation for one persisted import.
 */
async function handleBomImportMatch(response: ServerResponse, bomImportId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "bom-import-match",
      () => matchBomImportRowsInDatabase(bomImportId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "BOM_IMPORT_NOT_FOUND", "BOM import not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles evidence attachment metadata creation without changing approval, validation, or export readiness.
 */
async function handleEvidenceAttachmentCreate(request: IncomingMessage, response: ServerResponse, uploadedBy: string | null): Promise<void> {
  const body = await readJsonBody<EvidenceAttachmentCreateInput>(request);

  if (!body || !isEvidenceAttachmentCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_EVIDENCE_ATTACHMENT",
        message: "Evidence attachments require targetType, targetId, evidenceType, and title."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "evidence-attachment-create", () => createEvidenceAttachmentInDatabase(body, uploadedBy), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles local evidence file upload through the storage layer before persisting metadata.
 */
async function handleEvidenceAttachmentFileUpload(request: IncomingMessage, response: ServerResponse, uploadedBy: string | null): Promise<void> {
  const body = await readJsonBody<EvidenceAttachmentFileUploadInput>(request);

  if (!body || !isEvidenceAttachmentFileUploadInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_EVIDENCE_FILE_UPLOAD",
        message: "Evidence file upload requires targetType, targetId, title, fileName, and contentBase64."
      }
    });
    return;
  }

  const content = decodeEvidenceUploadContent(body.contentBase64);

  if (!content || content.length === 0 || content.length > maxEvidenceUploadBytes) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_EVIDENCE_FILE_CONTENT",
        message: `Evidence files must be valid base64 and no larger than ${maxEvidenceUploadBytes} bytes.`
      }
    });
    return;
  }

  const fileHash = createHash("sha256").update(content).digest("hex");
  const storageKey = buildEvidenceStorageKey(body.targetType, body.targetId, body.fileName, fileHash);

  try {
    await timeRouteOperation(response, "evidence-file-write", () => getStorageClient().write(storageKey, content), () => `${content.length} bytes`);
  } catch (error) {
    sendJson(response, getStorageClient().backend === "not_configured" ? 503 : 500, {
      error: {
        code: "EVIDENCE_STORAGE_WRITE_FAILED",
        message: error instanceof Error ? error.message : "Evidence file storage failed."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "evidence-file-metadata-create",
      () => createEvidenceAttachmentInDatabase({
        evidenceType: "file",
        fileHash,
        mimeType: normalizeOptionalBodyString(body.mimeType) ?? "application/octet-stream",
        notes: normalizeOptionalBodyString(body.notes) ?? null,
        provenance: normalizeOptionalBodyString(body.provenance) ?? "manual_internal",
        reviewStatus: body.reviewStatus ?? "unreviewed",
        storageKey,
        targetId: body.targetId,
        targetType: body.targetType,
        title: body.title
      }, uploadedBy),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles evidence review edits without changing target validation or approval.
 */
async function handleEvidenceAttachmentUpdate(request: IncomingMessage, response: ServerResponse, evidenceAttachmentId: string): Promise<void> {
  const body = await readJsonBody<EvidenceAttachmentUpdateInput>(request);

  if (!body || !isEvidenceAttachmentUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_EVIDENCE_ATTACHMENT_UPDATE",
        message: "Evidence review edits require reviewStatus and optional notes."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "evidence-attachment-update", () => updateEvidenceAttachmentInDatabase(evidenceAttachmentId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "EVIDENCE_ATTACHMENT_NOT_FOUND", "Evidence attachment not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles project follow-up sync from computed BOM health findings.
 */
async function handleProjectFollowUpsSync(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(response, "project-follow-ups-sync", () => syncProjectFollowUpsFromBomHealthInDatabase(projectId), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles circuit block follow-up sync from linked required-role readiness gaps.
 */
async function handleCircuitBlockFollowUpsSync(response: ServerResponse, circuitBlockId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(response, "circuit-block-follow-ups-sync", () => syncCircuitBlockFollowUpsFromReadinessInDatabase(circuitBlockId), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "CIRCUIT_BLOCK_NOT_FOUND", "Circuit block not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles follow-up workflow edits without altering the computed source records.
 */
async function handleFollowUpUpdate(request: IncomingMessage, response: ServerResponse, followUpId: string): Promise<void> {
  const body = await readJsonBody<FollowUpUpdateInput>(request);

  if (!body || !isFollowUpUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_FOLLOW_UP_UPDATE",
        message: "Follow-up edits require a valid status and optional workflow metadata."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "follow-up-update", () => updateFollowUpInDatabase(followUpId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "FOLLOW_UP_NOT_FOUND", "Follow-up record not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles circuit block creation while preserving linked-part readiness boundaries.
 */
async function handleCircuitBlockCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<CircuitBlockCreateInput>(request);

  if (!body || !isCircuitBlockCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK",
        message: "Circuit block creation requires blockKey, name, and supported blockType."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "circuit-block-create", () => createCircuitBlockInDatabase(body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "conflict") {
      sendJson(response, 409, {
        error: {
          code: "CIRCUIT_BLOCK_EXISTS",
          message: result.message
        }
      });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles circuit block metadata edits without changing linked part trust state.
 */
async function handleCircuitBlockUpdate(request: IncomingMessage, response: ServerResponse, circuitBlockId: string): Promise<void> {
  const body = await readJsonBody<CircuitBlockUpdateInput>(request);

  if (!body || !isCircuitBlockUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK_UPDATE",
        message: "Circuit block update requires name, supported type, and valid status."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "circuit-block-update", () => updateCircuitBlockInDatabase(circuitBlockId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "CIRCUIT_BLOCK_NOT_FOUND", "Circuit block not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles adding or refreshing a part role inside one circuit block.
 */
async function handleCircuitBlockPartCreate(request: IncomingMessage, response: ServerResponse, circuitBlockId: string): Promise<void> {
  const body = await readJsonBody<CircuitBlockPartCreateInput>(request);

  if (!body || !isCircuitBlockPartCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK_PART",
        message: "Circuit block part creation requires partId and role."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "circuit-block-part-create", () => createCircuitBlockPartInDatabase(circuitBlockId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles circuit block part-role metadata edits without changing part identity.
 */
async function handleCircuitBlockPartUpdate(request: IncomingMessage, response: ServerResponse, circuitBlockId: string, circuitBlockPartId: string): Promise<void> {
  const body = await readJsonBody<CircuitBlockPartUpdateInput>(request);

  if (!body || !isCircuitBlockPartUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK_PART_UPDATE",
        message: "Circuit block part update requires requirement, quantity, and substitution metadata."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "circuit-block-part-update", () => updateCircuitBlockPartInDatabase(circuitBlockId, circuitBlockPartId, body), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles recording one engineering-memory observation against a circuit block.
 *
 * The store performs schema-aware validation (trimmed title, allow-listed severity, defaults
 * etc); this handler validates only the gross shape so unrelated rejections come through as
 * 400 rather than 500.
 */
async function handleCircuitBlockKnownRiskCreate(
  request: IncomingMessage,
  response: ServerResponse,
  circuitBlockId: string
): Promise<void> {
  const body = await readJsonBody<CircuitBlockKnownRiskCreateInput>(request);

  if (!body || !isCircuitBlockKnownRiskCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK_KNOWN_RISK",
        message: "Known risk creation requires at least a non-empty title."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-known-risk-create",
      () => createCircuitBlockKnownRiskInDatabase(circuitBlockId, body),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles resolving one known-risk row. Resolution preserves the original observation
 * (the row is updated, not deleted) so projects that reused the block while the risk was
 * open can still be audited.
 */
async function handleCircuitBlockKnownRiskResolve(
  request: IncomingMessage,
  response: ServerResponse,
  circuitBlockId: string,
  knownRiskId: string
): Promise<void> {
  const body = await readJsonBody<CircuitBlockKnownRiskResolveInput>(request);
  const resolveInput: CircuitBlockKnownRiskResolveInput = body ?? {};

  if (!isCircuitBlockKnownRiskResolveInput(resolveInput)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK_KNOWN_RISK_RESOLVE",
        message: "Known risk resolution accepts optional resolvedBy and resolutionNotes string fields."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-known-risk-resolve",
      () => resolveCircuitBlockKnownRiskInDatabase(circuitBlockId, knownRiskId, resolveInput),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, result.code, result.message);
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project-memory list requests.
 */
async function handleProjectListRead(response: ServerResponse): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-list-read",
      () => readProjectsFromDatabase(),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles the cross-project risk dashboard read.
 */
async function handleProjectFleetRiskRead(response: ServerResponse): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-fleet-risk-read",
      () => readProjectFleetRiskFromDatabase(),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only circuit block library requests.
 */
async function handleCircuitBlockListRead(response: ServerResponse, url: URL): Promise<void> {
  const filters = parseCircuitBlockListFilters(url);

  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-list-read",
      () => readCircuitBlocksFromDatabase(filters),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Parses optional library filter query parameters into a `CircuitBlockListFilters` record.
 *
 * Unknown values are silently dropped so the API never returns an error for a curious URL.
 * The response echoes back the filters it actually applied so the UI can self-correct.
 */
function parseCircuitBlockListFilters(url: URL): CircuitBlockListFilters {
  const query = (url.searchParams.get("q") ?? "").trim();
  const blockTypeRaw = (url.searchParams.get("type") ?? "").trim();
  const statusRaw = (url.searchParams.get("status") ?? "").trim();
  const owner = (url.searchParams.get("owner") ?? "").trim();
  const readinessRaw = (url.searchParams.get("readiness") ?? "").trim();

  const allowedBlockTypes: ReadonlySet<CircuitBlockType> = new Set<CircuitBlockType>([
    "power",
    "mcu_support",
    "interface",
    "protection",
    "connector_set",
    "sensor_front_end",
    "other"
  ]);
  const allowedStatuses: ReadonlySet<CircuitBlockStatus> = new Set<CircuitBlockStatus>([
    "draft",
    "in_review",
    "approved",
    "deprecated",
    "restricted"
  ]);
  const allowedReadiness: ReadonlySet<CircuitBlockReuseReadinessFilter> = new Set<CircuitBlockReuseReadinessFilter>([
    "reusable",
    "pending",
    "blocked"
  ]);

  return {
    blockType: allowedBlockTypes.has(blockTypeRaw as CircuitBlockType) ? (blockTypeRaw as CircuitBlockType) : null,
    owner: owner.length > 0 ? owner : null,
    query: query.length > 0 ? query : null,
    reuseReadiness: allowedReadiness.has(readinessRaw as CircuitBlockReuseReadinessFilter)
      ? (readinessRaw as CircuitBlockReuseReadinessFilter)
      : null,
    status: allowedStatuses.has(statusRaw as CircuitBlockStatus) ? (statusRaw as CircuitBlockStatus) : null
  };
}

/**
 * Handles read-only circuit block detail requests.
 */
async function handleCircuitBlockDetailRead(response: ServerResponse, circuitBlockId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-detail-read",
      () => readCircuitBlockDetailFromDatabase(circuitBlockId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "CIRCUIT_BLOCK_NOT_FOUND", "Circuit block not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles project file mirror uploads.
 *
 * Looks up the project to confirm it exists, validates the requested category, then
 * delegates to the file mirror service. Each typed failure result maps to a precise
 * 4xx response so engineers always know why an upload was rejected (filename, content,
 * size, traversal). Filesystem errors map to 500 with a redacted message.
 */
async function handleProjectFileUpload(
  request: IncomingMessage,
  response: ServerResponse,
  projectId: string,
  rawCategory: string
): Promise<void> {
  const category = resolveProjectFolderCategory(rawCategory);
  if (!category) {
    sendJson(response, 404, {
      error: {
        code: "PROJECT_FILE_CATEGORY_UNKNOWN",
        message: "Project file category must be parts_list, datasheets, models, or notes."
      }
    });
    return;
  }

  const body = await readJsonBody<ProjectFileUploadInput>(request);
  if (!body || typeof body.filename !== "string") {
    sendJson(response, 400, {
      error: {
        code: "INVALID_PROJECT_FILE_UPLOAD",
        message: "Project file uploads require a filename and either contentBase64 or content."
      }
    });
    return;
  }

  try {
    const detail = await timeRouteOperation(
      response,
      "project-file-upload-detail",
      () => readProjectDetailFromDatabase(projectId),
      (value) => value.status
    );

    if (detail.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (detail.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    const project = detail.response.project;
    const result = await timeRouteOperation(
      response,
      "project-file-upload-write",
      () => saveProjectFile({ id: project.id, projectKey: project.projectKey }, category, body),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "PROJECT_FILES_NOT_CONFIGURED",
          message: "EE_LIBRARY_PROJECT_FILES_ROOT is set to off on the API host, so project file uploads are disabled."
        }
      });
      return;
    }

    if (result.status === "invalid_category") {
      sendJson(response, 404, {
        error: {
          code: "PROJECT_FILE_CATEGORY_UNKNOWN",
          message: "Project file category must be parts_list, datasheets, models, or notes."
        }
      });
      return;
    }

    if (result.status === "invalid_filename") {
      sendJson(response, 400, {
        error: {
          code: "INVALID_PROJECT_FILE_NAME",
          message: result.message
        }
      });
      return;
    }

    if (result.status === "invalid_content") {
      sendJson(response, 400, {
        error: {
          code: "INVALID_PROJECT_FILE_CONTENT",
          message: result.message
        }
      });
      return;
    }

    if (result.status === "too_large") {
      sendJson(response, 413, {
        error: {
          code: "PROJECT_FILE_TOO_LARGE",
          message: result.message
        }
      });
      return;
    }

    if (result.status === "error") {
      sendJson(response, 500, {
        error: {
          code: "PROJECT_FILE_WRITE_FAILED",
          message: result.message
        }
      });
      return;
    }

    sendCatalogJsonWithStatus(
      response,
      201,
      {
        absolutePath: result.absolutePath,
        category: result.category,
        entry: result.entry
      },
      "database"
    );
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles vendor notebook reads. Returns the catalog envelope shape so the web client
 * treats reachability errors consistently. The vendor mirror lives entirely on disk so
 * no DB lookup is required here; reachability is reported via `availability`.
 */
async function handleVendorListRead(response: ServerResponse): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "vendor-list",
      () => buildVendorListResponse(),
      (value) => `${value.availability}:${value.vendors.length}`
    );
    sendCatalogJson(response, result, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only vendor detail requests. The service returns vendor=null inside the
 * configured envelope when the slug is unknown, which the UI maps to a calm 404 panel.
 */
async function handleVendorDetailRead(response: ServerResponse, slug: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "vendor-detail",
      () => buildVendorDetailResponse(slug),
      (value) => `${value.availability}:${value.vendor ? "found" : "missing"}`
    );
    sendCatalogJson(response, result, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles vendor record creation. Requests must include a name and a supported category.
 * The service rejects empty names, oversized summaries, and slug collisions with typed
 * results so the route returns precise 4xx codes.
 */
async function handleVendorCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<VendorCreateInput>(request);
  if (!body || typeof body.name !== "string" || typeof body.category !== "string") {
    sendJson(response, 400, {
      error: {
        code: "INVALID_VENDOR_CREATE_REQUEST",
        message: "Vendor create requires a name and a supported category."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "vendor-create",
      () => createVendor(body),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "VENDOR_NOTES_NOT_CONFIGURED",
          message: "EE_LIBRARY_VENDOR_NOTES_ROOT is set to off on the API host, so supplier notes are disabled."
        }
      });
      return;
    }

    if (result.status === "invalid_name") {
      sendJson(response, 400, { error: { code: "INVALID_VENDOR_NAME", message: result.message } });
      return;
    }

    if (result.status === "invalid_category") {
      sendJson(response, 400, {
        error: {
          code: "INVALID_VENDOR_CATEGORY",
          message: "Vendor category must be one of pcb_fab, sheet_metal, machining, finishing, electronics_assembly, distributor, other."
        }
      });
      return;
    }

    if (result.status === "invalid_summary") {
      sendJson(response, 400, { error: { code: "INVALID_VENDOR_SUMMARY", message: result.message } });
      return;
    }

    if (result.status === "conflict") {
      sendJson(response, 409, { error: { code: "VENDOR_SLUG_CONFLICT", message: result.message } });
      return;
    }

    if (result.status === "error") {
      sendJson(response, 500, { error: { code: "VENDOR_CREATE_FAILED", message: result.message } });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, { vendor: result.vendor }, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles vendor file uploads. Each typed failure result maps to a precise 4xx response
 * so engineers always know why an upload was rejected.
 */
async function handleVendorFileUpload(
  request: IncomingMessage,
  response: ServerResponse,
  slug: string,
  rawSection: string
): Promise<void> {
  const section = resolveVendorFolderSection(rawSection);
  if (!section) {
    sendJson(response, 404, {
      error: {
        code: "VENDOR_FILE_SECTION_UNKNOWN",
        message: "Vendor file section must be 'notes' or 'files'."
      }
    });
    return;
  }

  const body = await readJsonBody<VendorFileUploadInput>(request);
  if (!body || typeof body.filename !== "string") {
    sendJson(response, 400, {
      error: {
        code: "INVALID_VENDOR_FILE_UPLOAD",
        message: "Vendor file uploads require a filename and either contentBase64 or content."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "vendor-file-upload",
      () => saveVendorFile(slug, section, body),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "VENDOR_NOTES_NOT_CONFIGURED",
          message: "EE_LIBRARY_VENDOR_NOTES_ROOT is set to off on the API host, so supplier uploads are disabled."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: "VENDOR_NOT_FOUND", message: "Vendor not found." } });
      return;
    }

    if (result.status === "invalid_section") {
      sendJson(response, 404, {
        error: {
          code: "VENDOR_FILE_SECTION_UNKNOWN",
          message: "Vendor file section must be 'notes' or 'files'."
        }
      });
      return;
    }

    if (result.status === "invalid_filename") {
      sendJson(response, 400, { error: { code: "INVALID_VENDOR_FILE_NAME", message: result.message } });
      return;
    }

    if (result.status === "invalid_content") {
      sendJson(response, 400, { error: { code: "INVALID_VENDOR_FILE_CONTENT", message: result.message } });
      return;
    }

    if (result.status === "too_large") {
      sendJson(response, 413, { error: { code: "VENDOR_FILE_TOO_LARGE", message: result.message } });
      return;
    }

    if (result.status === "error") {
      sendJson(response, 500, { error: { code: "VENDOR_FILE_WRITE_FAILED", message: result.message } });
      return;
    }

    sendCatalogJsonWithStatus(
      response,
      201,
      {
        absolutePath: result.absolutePath,
        section: result.section,
        entry: result.entry
      },
      "database"
    );
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project file mirror requests.
 *
 * Looks up the project so we can resolve its on-disk folder by `projectKey`, then
 * delegates to the file mirror service. Database-side errors (not_configured / not_found)
 * are mapped to the same envelope shape as the rest of the project memory routes so the
 * web client treats them consistently.
 */
async function handleProjectFilesRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-files-read",
      () => readProjectDetailFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    const project = result.response.project;
    const filesResponse = await timeRouteOperation(
      response,
      "project-files-listing",
      () => buildProjectFilesResponse({ id: project.id, projectKey: project.projectKey }),
      (value) => `${value.availability}:${value.folders.length}`
    );

    sendCatalogJson(response, filesResponse, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project detail requests.
 */
async function handleProjectDetailRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-detail-read",
      () => readProjectDetailFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project revision collection requests.
 */
async function handleProjectRevisionsRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-revisions-read",
      () => readProjectRevisionsFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles revision-vs-revision BOM compare reads scoped to one project.
 */
async function handleProjectRevisionCompareRead(response: ServerResponse, projectId: string, url: URL): Promise<void> {
  const fromRevisionId = url.searchParams.get("from");
  const toRevisionId = url.searchParams.get("to");

  if (!fromRevisionId || !toRevisionId) {
    sendJson(response, 400, {
      error: {
        code: "REVISION_COMPARE_PARAMS_REQUIRED",
        message: "Revision compare requires from and to query parameters."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "project-revision-compare",
      () => readProjectRevisionCompareFromDatabase(projectId, fromRevisionId, toRevisionId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles persisted BOM revision approval gate reads scoped to one project.
 */
async function handleProjectRevisionApprovalGatesRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-revision-approval-gates-read",
      () => readProjectRevisionApprovalGatesFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles admin-gated BOM revision approval gate decisions for one project.
 */
async function handleProjectRevisionApprovalGateApply(request: IncomingMessage, response: ServerResponse, projectId: string, actor: string): Promise<void> {
  const body = await readJsonBody<ProjectRevisionApprovalGateRequest>(request);

  if (!body || typeof body.fromRevisionId !== "string" || typeof body.toRevisionId !== "string" || typeof body.decision !== "string") {
    sendJson(response, 400, {
      error: {
        code: "INVALID_REVISION_APPROVAL_GATE_REQUEST",
        message: "Body requires fromRevisionId, toRevisionId, and decision."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "project-revision-approval-gate-apply",
      () => upsertProjectRevisionApprovalGateInDatabase(projectId, body, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project BOM import collection requests.
 */
async function handleProjectBomImportsRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-bom-imports-read",
      () => readProjectBomImportsFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only BOM line collection requests.
 */
async function handleBomImportLinesRead(response: ServerResponse, bomImportId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "bom-import-lines-read",
      () => readBomImportLinesFromDatabase(bomImportId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "BOM_IMPORT_NOT_FOUND", "BOM import not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only confirmed project usage collection requests.
 */
async function handleProjectPartUsagesRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-part-usages-read",
      () => readProjectPartUsagesFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only BOM health projection requests for one project.
 */
async function handleProjectBomHealthRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-bom-health-read",
      () => readProjectBomHealthFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project evidence metadata requests.
 */
async function handleProjectEvidenceAttachmentsRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-evidence-read",
      () => readProjectEvidenceAttachmentsFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles global evidence vault reads with target, review, provenance, and storage filters.
 */
async function handleEvidenceAttachmentsRead(response: ServerResponse, url: URL): Promise<void> {
  const filters = readEvidenceAttachmentListFilters(url);

  try {
    const result = await timeRouteOperation(
      response,
      "evidence-attachments-read",
      () => readEvidenceAttachmentsFromDatabase(filters),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project follow-up queue requests.
 */
async function handleProjectFollowUpsRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "project-follow-ups-read",
      () => readProjectFollowUpsFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only circuit block follow-up queue requests.
 */
async function handleCircuitBlockFollowUpsRead(response: ServerResponse, circuitBlockId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-follow-ups-read",
      () => readCircuitBlockFollowUpsFromDatabase(circuitBlockId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "CIRCUIT_BLOCK_NOT_FOUND", "Circuit block not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only project dependency requests for one circuit block.
 */
async function handleCircuitBlockProjectDependenciesRead(response: ServerResponse, circuitBlockId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-project-deps-read",
      () => readCircuitBlockProjectDependenciesFromDatabase(circuitBlockId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "CIRCUIT_BLOCK_NOT_FOUND", "Circuit block not found.");
      return;
    }

    sendCatalogJson(response, { dependencies: result.dependencies }, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only where-used history requests for one internal part.
 */
async function handlePartWhereUsedRead(response: ServerResponse, partId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "part-where-used-read",
      () => readPartWhereUsedFromDatabase(partId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PART_NOT_FOUND", "Part not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles read-only supply offer snapshots for one internal part.
 */
async function handlePartSupplyOffersRead(response: ServerResponse, partId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "part-supply-offers-read",
      () => readPartSupplyOffersFromDatabase(partId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendSupplyOffersNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles global where-used search across supported project-memory dependency records.
 */
async function handleWhereUsedSearchRead(response: ServerResponse, url: URL): Promise<void> {
  const targetType = readWhereUsedTargetType(url.searchParams.get("targetType"));
  const query = url.searchParams.get("q") ?? "";

  try {
    const result = await timeRouteOperation(
      response,
      "where-used-search-read",
      () => readWhereUsedSearchFromDatabase(targetType, query),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles connector-set catalog reads grouped by connector_class with mate context.
 */
async function handleConnectorSetCatalogRead(response: ServerResponse, url: URL): Promise<void> {
  const connectorClassFilter = readConnectorClass(url.searchParams.get("connectorClass")) ?? null;
  const queryFilter = (url.searchParams.get("q") ?? "").trim();
  const filters: { connectorClass?: ConnectorClass | null; query?: string | null } = {
    connectorClass: connectorClassFilter,
    query: queryFilter.length > 0 ? queryFilter : null
  };

  try {
    const result = await timeRouteOperation(
      response,
      "connector-set-list-read",
      () => readConnectorSetCatalogFromDatabase(filters),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles typed connector-set intent resolution against persisted catalog relationship rows.
 */
async function handleConnectorSetIntentResolve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<Partial<ConnectorSetIntentInput>>(request);
  const intent = parseConnectorSetIntentInput(body);

  if (!intent) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CONNECTOR_SET_INTENT",
        message: "Connector-set intent requires a non-empty class string. Optional fields are query, pinCount, sealing, and cableGauge."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "connector-set-intent-resolve",
      () => readCatalogRecordsFromDatabase(),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    sendCatalogJson(response, resolveConnectorSetIntent(intent, result.records), "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Parses connector intent from JSON while rejecting values that would make confidence misleading.
 */
function parseConnectorSetIntentInput(input: Partial<ConnectorSetIntentInput> | null): ConnectorSetIntentInput | null {
  const query = typeof input?.query === "string" && input.query.trim().length > 0 ? input.query.trim() : null;
  const parsedTextIntent = query ? parseConnectorSetIntentText(query) : null;
  const connectorClass = typeof input?.class === "string" && input.class.trim().length > 0 ? input.class.trim() : parsedTextIntent?.class ?? "";

  if (connectorClass.length === 0) {
    return null;
  }

  return {
    cableGauge: typeof input?.cableGauge === "number" && Number.isFinite(input.cableGauge) ? Math.trunc(input.cableGauge) : parsedTextIntent?.cableGauge ?? null,
    class: connectorClass,
    pinCount: typeof input?.pinCount === "number" && Number.isFinite(input.pinCount) ? Math.trunc(input.pinCount) : parsedTextIntent?.pinCount ?? null,
    query,
    sealing: typeof input?.sealing === "string" && input.sealing.trim().length > 0 ? input.sealing.trim() : parsedTextIntent?.sealing ?? null
  };
}

/**
 * Handles project-scoped approval candidate reads. The candidate set is built from confirmed
 * usage and matched BOM lines whose part is not yet approved.
 */
async function handleApprovalBatchCandidatesRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "approval-batch-candidates-read",
      () => readApprovalBatchCandidatesFromDatabase(projectId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles bulk approval actions triggered from a project BOM context. Approval state is
 * the only field changed; readiness, asset validation, and export verification are not touched.
 */
async function handleApprovalBatchApply(request: IncomingMessage, response: ServerResponse, projectId: string, decidedBy: string): Promise<void> {
  const body = await readJsonBody<ApprovalBatchRequest>(request);

  if (!body || !Array.isArray(body.partIds) || (body.action !== "approve" && body.action !== "flag_for_review")) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_APPROVAL_BATCH",
        message: "Approval batch requires partIds[] and action of 'approve' or 'flag_for_review'."
      }
    });
    return;
  }

  const action: ApprovalBatchAction = body.action;
  const normalized: ApprovalBatchRequest = {
    action,
    notes: typeof body.notes === "string" ? body.notes : null,
    partIds: body.partIds.filter((value): value is string => typeof value === "string")
  };

  try {
    const result = await timeRouteOperation(
      response,
      "approval-batch-apply",
      () => applyApprovalBatchInDatabase(projectId, normalized, decidedBy),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, {
        error: {
          code: result.code,
          message: result.message
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
 * Handles controlled document revision reads for the part workspace.
 */
async function handlePartDocumentRevisionsRead(response: ServerResponse, partId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "document-revisions-read",
      () => readDocumentRevisionsForPartFromDatabase(partId),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendDocumentControlNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles admin-gated controlled document revision creation from an existing asset.
 */
async function handleDocumentRevisionCreate(request: IncomingMessage, response: ServerResponse, partId: string, actor: string): Promise<void> {
  const body = await readJsonBody<DocumentRevisionCreateInput>(request);

  if (!body || !isDocumentRevisionCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_DOCUMENT_REVISION",
        message: "Document revisions require an assetId and revisionLabel."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "document-revision-create",
      () => createDocumentRevisionInDatabase(partId, body, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendDocumentControlNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "conflict") {
      sendJson(response, 409, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles admin-gated engineering redline note creation for a controlled revision.
 */
async function handleDocumentRedlineCreate(request: IncomingMessage, response: ServerResponse, documentRevisionId: string, actor: string): Promise<void> {
  const body = await readJsonBody<DocumentRedlineCreateInput>(request);

  if (!body || !isDocumentRedlineCreateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_DOCUMENT_REDLINE",
        message: "Document redlines require a note and optional severity/page anchor."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "document-redline-create",
      () => createDocumentRedlineInDatabase(documentRevisionId, body, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendDocumentControlNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Handles admin-gated redline workflow updates without mutating controlled document release state.
 */
async function handleDocumentRedlineUpdate(request: IncomingMessage, response: ServerResponse, redlineId: string, actor: string): Promise<void> {
  const body = await readJsonBody<DocumentRedlineUpdateInput>(request);

  if (!body || !isDocumentRedlineUpdateInput(body)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_DOCUMENT_REDLINE_UPDATE",
        message: "Document redline updates require a supported redlineStatus."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "document-redline-update",
      () => updateDocumentRedlineInDatabase(redlineId, body, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendDocumentControlNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
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
/**
 * Streams a stored asset file from local storage after validating the key against path traversal.
 */
async function handleStorageFileServe(response: ServerResponse, rawEncodedKey: string): Promise<void> {
  const storageKey = decodeURIComponent(rawEncodedKey);
  const localBasePath = process.env["STORAGE_LOCAL_PATH"] ?? "./storage";
  const fullPath = resolveStorageKey(localBasePath, storageKey);

  if (!fullPath) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_STORAGE_KEY",
        message: "The storage key is invalid."
      }
    });
    return;
  }

  try {
    await access(fullPath);
  } catch {
    sendJson(response, 404, {
      error: {
        code: "FILE_NOT_FOUND",
        message: "The requested storage file was not found."
      }
    });
    return;
  }

  const ext = extname(fullPath).toLowerCase();
  const contentType = inferStorageContentType(ext);
  const isInline = contentType === "application/pdf" || contentType.startsWith("image/");
  const filename = basename(fullPath);

  response.writeHead(200, {
    "Content-Disposition": isInline ? "inline" : `attachment; filename="${filename}"`,
    "Content-Type": contentType,
    ...buildTelemetryHeaders(response, 200)
  });

  await new Promise<void>((resolve, reject) => {
    const readable = createReadStream(fullPath);
    readable.on("error", reject);
    response.on("error", reject);
    response.on("finish", resolve);
    readable.pipe(response);
  });
}

/**
 * Maps a file extension to a Content-Type for stored asset files.
 */
function inferStorageContentType(ext: string): string {
  const types: Record<string, string> = {
    ".dxf": "application/octet-stream",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".kicad_mod": "application/octet-stream",
    ".kicad_sym": "application/octet-stream",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".step": "application/octet-stream",
    ".stp": "application/octet-stream",
    ".webp": "image/webp"
  };

  return types[ext] ?? "application/octet-stream";
}

/**
 * Redirects to source_url for referenced assets, or reports why a file is not accessible.
 *
 * For restricted and ITAR-controlled assets the gate is consulted in this order:
 *   1. If the actor has a `view` or `admin` ACL grant on the gating revision, the
 *      download is authorized without acknowledgment.
 *   2. Otherwise, if the actor has the system `admin` role and the request includes
 *      `?ack=1`, the download is authorized as an admin override.
 *   3. Otherwise the request is denied with HTTP 403 ASSET_DOWNLOAD_GATED.
 *
 * Every decision lands in the audit-events stream via the middleware capture path,
 * with grant or override context recorded in the audit metadata.
 */
async function handleAssetDownload(request: IncomingMessage, response: ServerResponse, partId: string, assetId: string, url: URL): Promise<void> {
  try {
    const result = await timeRouteOperation(response, "asset-download-read", () => readAssetDownloadTargetFromDatabase(partId, assetId), (value) => value.status);

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Asset download requires a configured database."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "ASSET_NOT_FOUND",
          message: "The requested asset does not exist for this part."
        }
      });
      return;
    }

    if (result.status === "not_accessible") {
      sendJson(response, 404, {
        error: {
          code: "ASSET_NOT_ACCESSIBLE",
          message: result.reason
        }
      });
      return;
    }

    // Check controlled-document gating before issuing the download URL or redirect.
    const gateResult = await readAssetDownloadGateFromDatabase(assetId);

    if (gateResult.status === "decided" && gateResult.gate.status === "gated") {
      const session = readSessionFromRequest(request);
      const gate = gateResult.gate;
      const aclResult = await readAssetDownloadAclGrant(gate.revisionId, {
        userId: session?.sub ?? null,
        role: session?.role ?? null
      });

      const hasAclGrant = aclResult.status === "granted";
      const acknowledged = url.searchParams.get("ack") === "1";
      const isAdminOverride = !hasAclGrant && session?.role === "admin" && acknowledged;

      if (!hasAclGrant && !isAdminOverride) {
        const reason = session?.sub
          ? "No ACL grant authorizes this user, and admin override requires ?ack=1."
          : "No session attached and the gate cannot fall back to admin override.";
        sendJson(response, 403, {
          error: {
            code: "ASSET_DOWNLOAD_GATED",
            message: `This asset is ${gate.accessLevel.replace("_", " ")}. The current controlled revision is "${gate.revisionLabel}" (${gate.documentType}). ${reason}`,
            accessLevel: gate.accessLevel,
            revisionLabel: gate.revisionLabel,
            documentType: gate.documentType,
            grantStatus: hasAclGrant ? "granted" : "no_grant"
          }
        });
        return;
      }

      // Surface the grant or override path in response headers so the middleware
      // capture can attach it to the audit event metadata (the middleware reads
      // X-EE-* headers as part of its request context).
      const grant: AssetDownloadGrant | { status: "admin_override" } = hasAclGrant ? aclResult.grant : { status: "admin_override" };
      response.setHeader("X-EE-Asset-Gate-Grant", grant.status);
    }

    if (result.status === "redirect") {
      sendRedirect(response, result.url);
      return;
    }

    const fileUrl = await getStorageClient().getDownloadUrl(result.storageKey);

    if (!fileUrl) {
      sendJson(response, 503, {
        error: {
          code: "STORAGE_BACKEND_NOT_CONFIGURED",
          message: "This file has a local storage key but the storage backend could not produce a download URL."
        }
      });
      return;
    }

    sendRedirect(response, fileUrl);
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

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
 * Checks project status values without trusting JSON bodies.
 */
function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === "active" || value === "archived" || value === "prototype" || value === "production" || value === "deprecated";
}

/**
 * Checks project-create request shape before hitting persistence.
 */
function isProjectCreateInput(value: unknown): value is ProjectCreateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<ProjectCreateInput>;

  return typeof body.projectKey === "string" &&
    body.projectKey.trim().length > 0 &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    isOptionalBodyString(body.description) &&
    isOptionalBodyString(body.owner) &&
    isOptionalBodyString(body.initialRevisionLabel) &&
    (body.status === undefined || isProjectStatus(body.status));
}

/**
 * Checks project-update request shape before writing metadata.
 */
function isProjectUpdateInput(value: unknown): value is ProjectUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<ProjectUpdateInput>;

  return typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    isOptionalBodyString(body.description) &&
    isOptionalBodyString(body.owner) &&
    isProjectStatus(body.status);
}

/**
 * Checks project revision status values without trusting request JSON.
 */
function isProjectRevisionStatus(value: unknown): value is ProjectRevisionStatus {
  return value === "draft" || value === "in_review" || value === "released" || value === "superseded" || value === "archived";
}

/**
 * Checks project-revision update request shape before writing metadata.
 */
function isProjectRevisionUpdateInput(value: unknown): value is ProjectRevisionUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<ProjectRevisionUpdateInput>;

  return isProjectRevisionStatus(body.revisionStatus) &&
    isOptionalBodyString(body.sourceReference) &&
    isOptionalBodyString(body.releasedAt);
}

/**
 * Checks no-write BOM preview request shape.
 */
function isBomImportPreviewInput(value: unknown): value is BomImportPreviewInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<BomImportPreviewInput>;

  return (body.sourceFormat === "csv" || body.sourceFormat === "xlsx") &&
    typeof body.sourceFilename === "string" &&
    body.sourceFilename.trim().length > 0 &&
    typeof body.rawContent === "string" &&
    Buffer.byteLength(body.rawContent, "utf8") <= maxBomCsvBytes;
}

/**
 * Checks mapped BOM import request shape before parsing and persistence.
 */
function isBomImportCreateInput(value: unknown): value is BomImportCreateInput {
  if (!isBomImportPreviewInput(value)) {
    return false;
  }

  const body = value as Partial<BomImportCreateInput>;

  return isOptionalBodyString(body.projectRevisionId) &&
    isOptionalBodyString(body.revisionLabel) &&
    Boolean(body.columnMapping) &&
    typeof body.columnMapping === "object" &&
    isOptionalBodyString(body.columnMapping.mpn) &&
    isOptionalBodyString(body.columnMapping.manufacturer) &&
    isOptionalBodyString(body.columnMapping.quantity) &&
    isOptionalBodyString(body.columnMapping.designators) &&
    isOptionalBodyString(body.columnMapping.description) &&
    isOptionalBodyString(body.columnMapping.notes) &&
    isOptionalBodyString(body.columnMapping.supplierReference);
}

/**
 * Checks circuit block creation request shape before persistence validation.
 */
function isCircuitBlockCreateInput(value: unknown): value is CircuitBlockCreateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<CircuitBlockCreateInput>;

  return typeof body.blockKey === "string" &&
    body.blockKey.trim().length > 0 &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    isCircuitBlockType(body.blockType) &&
    isOptionalBodyString(body.description) &&
    isOptionalBodyString(body.owner) &&
    isOptionalBodyString(body.reuseScope) &&
    (body.status === undefined || isCircuitBlockStatus(body.status)) &&
    (body.constraints === undefined || body.constraints === null || (typeof body.constraints === "object" && !Array.isArray(body.constraints)));
}

/**
 * Checks circuit block update request shape before persistence validation.
 */
function isCircuitBlockUpdateInput(value: unknown): value is CircuitBlockUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<CircuitBlockUpdateInput>;

  return typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    isCircuitBlockType(body.blockType) &&
    isOptionalBodyString(body.description) &&
    isOptionalBodyString(body.owner) &&
    isOptionalBodyString(body.reuseScope) &&
    isCircuitBlockStatus(body.status) &&
    (body.constraints === undefined || body.constraints === null || (typeof body.constraints === "object" && !Array.isArray(body.constraints)));
}

/**
 * Checks circuit block part-role request shape before persistence validation.
 */
function isCircuitBlockPartCreateInput(value: unknown): value is CircuitBlockPartCreateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<CircuitBlockPartCreateInput>;

  return typeof body.partId === "string" &&
    body.partId.trim().length > 0 &&
    typeof body.role === "string" &&
    body.role.trim().length > 0 &&
    (body.quantity === undefined || body.quantity === null || (typeof body.quantity === "number" && Number.isFinite(body.quantity))) &&
    (body.isRequired === undefined || typeof body.isRequired === "boolean") &&
    (body.substitutionPolicy === undefined || isCircuitBlockPartSubstitutionPolicy(body.substitutionPolicy)) &&
    isOptionalBodyString(body.notes);
}

/**
 * Checks the gross shape of a known-risk create request before deep validation in the store.
 *
 * Accepts at minimum a non-empty `title`; other fields fall back to the store-side defaults
 * (`severity = caution`, `detail = ""`, etc). Severity is allow-listed here to mirror the
 * SQL CHECK constraint so unknown values get a 400 instead of a 500.
 */
function isCircuitBlockKnownRiskCreateInput(value: unknown): value is CircuitBlockKnownRiskCreateInput {
  if (!value || typeof value !== "object") return false;

  const body = value as Partial<CircuitBlockKnownRiskCreateInput>;

  if (typeof body.title !== "string" || body.title.trim().length === 0) return false;

  if (body.severity !== undefined && !isCircuitBlockKnownRiskSeverity(body.severity)) return false;

  return isOptionalBodyString(body.detail) &&
    isOptionalBodyString(body.recordedBy) &&
    isOptionalBodyString(body.evidenceUrl);
}

/**
 * Checks the gross shape of a known-risk resolve request. Both fields are optional strings;
 * an empty body (`{}`) is allowed so the endpoint can be called without provenance data.
 */
function isCircuitBlockKnownRiskResolveInput(value: unknown): value is CircuitBlockKnownRiskResolveInput {
  if (!value || typeof value !== "object") return false;

  const body = value as Partial<CircuitBlockKnownRiskResolveInput>;

  return isOptionalBodyString(body.resolvedBy) && isOptionalBodyString(body.resolutionNotes);
}

/** Allow-list check for CircuitBlockKnownRiskSeverity at the HTTP boundary. */
function isCircuitBlockKnownRiskSeverity(value: unknown): value is CircuitBlockKnownRiskSeverity {
  return value === "info" || value === "limitation" || value === "caution" || value === "blocking";
}

/**
 * Checks circuit block part-role update request shape before persistence validation.
 */
function isCircuitBlockPartUpdateInput(value: unknown): value is CircuitBlockPartUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<CircuitBlockPartUpdateInput>;

  return (body.quantity === undefined || body.quantity === null || (typeof body.quantity === "number" && Number.isFinite(body.quantity))) &&
    typeof body.isRequired === "boolean" &&
    isCircuitBlockPartSubstitutionPolicy(body.substitutionPolicy) &&
    isOptionalBodyString(body.notes);
}

/**
 * Checks evidence attachment request shape before persistence validation.
 */
function isEvidenceAttachmentCreateInput(value: unknown): value is EvidenceAttachmentCreateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<EvidenceAttachmentCreateInput>;

  return isEvidenceTargetType(body.targetType) &&
    typeof body.targetId === "string" &&
    body.targetId.trim().length > 0 &&
    isEvidenceAttachmentType(body.evidenceType) &&
    typeof body.title === "string" &&
    body.title.trim().length > 0 &&
    isOptionalBodyString(body.sourceUrl) &&
    isOptionalBodyString(body.storageKey) &&
    isOptionalBodyString(body.fileHash) &&
    isOptionalBodyString(body.mimeType) &&
    isOptionalBodyString(body.notes) &&
    isOptionalBodyString(body.provenance) &&
    (body.reviewStatus === undefined || isEvidenceReviewStatus(body.reviewStatus));
}

/**
 * Checks evidence file upload request shape before decoding content.
 */
function isEvidenceAttachmentFileUploadInput(value: unknown): value is EvidenceAttachmentFileUploadInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<EvidenceAttachmentFileUploadInput>;

  return isEvidenceTargetType(body.targetType) &&
    typeof body.targetId === "string" &&
    body.targetId.trim().length > 0 &&
    typeof body.title === "string" &&
    body.title.trim().length > 0 &&
    typeof body.fileName === "string" &&
    body.fileName.trim().length > 0 &&
    typeof body.contentBase64 === "string" &&
    body.contentBase64.trim().length > 0 &&
    isOptionalBodyString(body.mimeType) &&
    isOptionalBodyString(body.notes) &&
    isOptionalBodyString(body.provenance) &&
    (body.reviewStatus === undefined || isEvidenceReviewStatus(body.reviewStatus));
}

/**
 * Checks evidence review edit request shape before persistence validation.
 */
function isEvidenceAttachmentUpdateInput(value: unknown): value is EvidenceAttachmentUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<EvidenceAttachmentUpdateInput>;

  return isEvidenceReviewStatus(body.reviewStatus) && isOptionalBodyString(body.notes);
}

/**
 * Checks follow-up workflow edit request shape before store validation.
 */
function isFollowUpUpdateInput(value: unknown): value is FollowUpUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<FollowUpUpdateInput>;

  return isFollowUpStatus(body.status) &&
    isOptionalBodyString(body.assignedTo) &&
    isOptionalBodyString(body.resolutionNotes) &&
    (body.evidenceAttachmentIds === undefined || body.evidenceAttachmentIds === null || (Array.isArray(body.evidenceAttachmentIds) && body.evidenceAttachmentIds.every((id) => typeof id === "string")));
}

/**
 * Checks controlled document revision creation request shape before store validation.
 */
function isDocumentRevisionCreateInput(value: unknown): value is DocumentRevisionCreateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<DocumentRevisionCreateInput>;

  return typeof body.assetId === "string" &&
    body.assetId.trim().length > 0 &&
    typeof body.revisionLabel === "string" &&
    body.revisionLabel.trim().length > 0 &&
    (body.documentType === undefined || isDocumentControlType(body.documentType)) &&
    (body.revisionDate === undefined || body.revisionDate === null || typeof body.revisionDate === "string") &&
    (body.lifecycleStatus === undefined || isDocumentRevisionLifecycleStatus(body.lifecycleStatus)) &&
    (body.accessLevel === undefined || isDocumentAccessLevel(body.accessLevel)) &&
    isOptionalBodyString(body.accessNotes) &&
    isOptionalBodyString(body.effectiveAt) &&
    isOptionalBodyString(body.expiresAt) &&
    isOptionalBodyString(body.supersedesDocumentRevisionId) &&
    (body.aclEntries === undefined || (Array.isArray(body.aclEntries) && body.aclEntries.every(isDocumentAclEntryCreateInput)));
}

/**
 * Checks initial document ACL grant shape before store validation.
 */
function isDocumentAclEntryCreateInput(value: unknown): value is NonNullable<DocumentRevisionCreateInput["aclEntries"]>[number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<NonNullable<DocumentRevisionCreateInput["aclEntries"]>[number]>;

  return isDocumentAclPrincipalType(body.principalType) &&
    typeof body.principalId === "string" &&
    body.principalId.trim().length > 0 &&
    isDocumentAclPermission(body.permission) &&
    isOptionalBodyString(body.expiresAt);
}

/**
 * Checks document redline creation request shape before store validation.
 */
function isDocumentRedlineCreateInput(value: unknown): value is DocumentRedlineCreateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<DocumentRedlineCreateInput>;

  return typeof body.note === "string" &&
    body.note.trim().length > 0 &&
    (body.severity === undefined || isDocumentRedlineSeverity(body.severity)) &&
    (body.pageNumber === undefined || body.pageNumber === null || typeof body.pageNumber === "number") &&
    isOptionalBodyString(body.anchorText);
}

/**
 * Checks document redline update request shape before store validation.
 */
function isDocumentRedlineUpdateInput(value: unknown): value is DocumentRedlineUpdateInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<DocumentRedlineUpdateInput>;

  return isDocumentRedlineStatus(body.redlineStatus) && isOptionalBodyString(body.note);
}

/**
 * Reads provider-neutral evidence vault filters from query params.
 */
function readEvidenceAttachmentListFilters(url: URL): EvidenceAttachmentListFilters {
  return {
    evidenceType: readEvidenceAttachmentType(url.searchParams.get("evidenceType")),
    query: normalizeOptionalBodyString(url.searchParams.get("q")) ?? null,
    reviewStatus: readEvidenceReviewStatus(url.searchParams.get("reviewStatus")),
    sourceSystem: normalizeOptionalBodyString(url.searchParams.get("sourceSystem")) ?? null,
    storageState: readEvidenceStorageState(url.searchParams.get("storageState")),
    targetType: readEvidenceTargetType(url.searchParams.get("targetType"))
  };
}

/**
 * Checks evidence target type values without exposing table names to request bodies.
 */
function isEvidenceTargetType(value: unknown): value is EvidenceTargetType {
  return value === "part" ||
    value === "asset" ||
    value === "project" ||
    value === "bom_import" ||
    value === "bom_line" ||
    value === "project_part_usage" ||
    value === "risk_finding" ||
    value === "circuit_block" ||
    value === "circuit_block_part";
}

/**
 * Checks controlled document type values.
 */
function isDocumentControlType(value: unknown): value is DocumentControlType {
  return value === "datasheet" || value === "mechanical_drawing" || value === "controlled_drawing" || value === "specification" || value === "other";
}

/**
 * Checks controlled document lifecycle values.
 */
function isDocumentRevisionLifecycleStatus(value: unknown): value is DocumentRevisionLifecycleStatus {
  return value === "draft" || value === "in_review" || value === "released" || value === "superseded" || value === "expired" || value === "archived";
}

/**
 * Checks controlled document access-level values.
 */
function isDocumentAccessLevel(value: unknown): value is DocumentAccessLevel {
  return value === "public" || value === "internal" || value === "restricted" || value === "itar_controlled";
}

/**
 * Checks controlled document ACL principal values.
 */
function isDocumentAclPrincipalType(value: unknown): value is DocumentAclPrincipalType {
  return value === "user" || value === "team" || value === "role";
}

/**
 * Checks controlled document ACL permission values.
 */
function isDocumentAclPermission(value: unknown): value is DocumentAclPermission {
  return value === "view" || value === "review" || value === "approve" || value === "admin";
}

/**
 * Checks controlled document redline severity values.
 */
function isDocumentRedlineSeverity(value: unknown): value is DocumentRedlineSeverity {
  return value === "info" || value === "review" || value === "blocker";
}

/**
 * Checks controlled document redline status values.
 */
function isDocumentRedlineStatus(value: unknown): value is DocumentRedlineStatus {
  return value === "open" || value === "resolved" || value === "rejected" || value === "superseded";
}

/**
 * Checks circuit block category values.
 */
function isCircuitBlockType(value: unknown): value is CircuitBlockType {
  return value === "power" || value === "mcu_support" || value === "interface" || value === "protection" || value === "connector_set" || value === "sensor_front_end" || value === "other";
}

/**
 * Checks circuit block review states without inferring part readiness.
 */
function isCircuitBlockStatus(value: unknown): value is CircuitBlockStatus {
  return value === "draft" || value === "in_review" || value === "approved" || value === "restricted" || value === "deprecated";
}

/**
 * Checks circuit block substitution policy values.
 */
function isCircuitBlockPartSubstitutionPolicy(value: unknown): value is CircuitBlockPartSubstitutionPolicy {
  return value === "exact_required" || value === "approved_alternate_allowed" || value === "equivalent_allowed" || value === "do_not_substitute";
}

/**
 * Reads a global where-used target type without accepting arbitrary target labels.
 */
function readWhereUsedTargetType(value: string | null): WhereUsedTargetType {
  if (value === "circuit_block" || value === "connector_set" || value === "asset") {
    return value;
  }

  return "part";
}

/**
 * Checks evidence attachment type values.
 */
function isEvidenceAttachmentType(value: unknown): value is EvidenceAttachmentType {
  return value === "note" || value === "link" || value === "file";
}

/**
 * Checks evidence review statuses without treating acceptance as approval.
 */
function isEvidenceReviewStatus(value: unknown): value is EvidenceReviewStatus {
  return value === "unreviewed" || value === "accepted" || value === "rejected" || value === "superseded";
}

/**
 * Checks evidence storage filter values without treating stored files as exportable.
 */
function isEvidenceStorageState(value: unknown): value is EvidenceStorageState {
  return value === "file_backed" || value === "link_only" || value === "note_only";
}

/**
 * Checks follow-up workflow states without changing source readiness state.
 */
function isFollowUpStatus(value: unknown): value is FollowUpStatus {
  return value === "open" || value === "in_progress" || value === "resolved" || value === "dismissed";
}

/**
 * Reads an evidence target filter while dropping unsupported query values.
 */
function readEvidenceTargetType(value: string | null): EvidenceTargetType | null {
  return isEvidenceTargetType(value) ? value : null;
}

/**
 * Reads an evidence kind filter while dropping unsupported query values.
 */
function readEvidenceAttachmentType(value: string | null): EvidenceAttachmentType | null {
  return isEvidenceAttachmentType(value) ? value : null;
}

/**
 * Reads an evidence review filter while dropping unsupported query values.
 */
function readEvidenceReviewStatus(value: string | null): EvidenceReviewStatus | null {
  return isEvidenceReviewStatus(value) ? value : null;
}

/**
 * Reads a storage-state filter while dropping unsupported query values.
 */
function readEvidenceStorageState(value: string | null): EvidenceStorageState | null {
  return isEvidenceStorageState(value) ? value : null;
}

/**
 * Decodes browser-provided base64 evidence content with optional data URL prefix.
 */
function decodeEvidenceUploadContent(contentBase64: string): Buffer | null {
  const rawBase64 = contentBase64.includes(",") ? contentBase64.slice(contentBase64.indexOf(",") + 1) : contentBase64;
  const compactBase64 = rawBase64.replace(/\s+/gu, "");

  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compactBase64)) {
    return null;
  }

  return Buffer.from(compactBase64, "base64");
}

/**
 * Builds a deterministic storage key from target identity, content hash, and original filename.
 */
function buildEvidenceStorageKey(targetType: EvidenceTargetType, targetId: string, fileName: string, fileHash: string): string {
  const normalizedName = basename(fileName).replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "evidence-file";
  const extension = extname(normalizedName);
  const nameWithoutExtension = extension ? normalizedName.slice(0, -extension.length) : normalizedName;
  const safeName = `${nameWithoutExtension.slice(0, 72)}${extension.slice(0, 16)}`;

  return `evidence/${targetType}/${slugStorageSegment(targetId)}/${fileHash.slice(0, 16)}-${safeName}`;
}

/**
 * Sanitizes user-provided target ids before using them as storage path segments.
 */
function slugStorageSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "target";
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
 * Reads the audit event limit query parameter with conservative bounds for admin tables.
 */
function readAuditEventLimit(value: string | null): number {
  const parsed = value ? Number(value) : 30;

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

/**
 * Starts audit context for one request and preserves any caller-provided request id when safe.
 */
function beginRequestAuditContext(response: ServerResponse, request: IncomingMessage): void {
  requestAuditContexts.set(response, {
    requestId: readRequestId(request.headers["x-request-id"]) ?? randomUUID()
  });
}

/**
 * Writes the audit event for unsafe API methods after the response status is known.
 */
async function flushRequestAuditEvent(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const context = requestAuditContexts.get(response);
  requestAuditContexts.delete(response);

  if (!context) {
    return;
  }

  const method = request.method ?? "UNKNOWN";
  const descriptor = describeAuditableRequest(method, url);

  if (!descriptor) {
    return;
  }

  const session = readSessionFromRequest(request);
  const statusCode = response.headersSent ? response.statusCode : 500;
  const operation = classifyRouteOperation(method, url.pathname);

  try {
    await createAuditEventInDatabase({
      action: descriptor.action,
      actorId: session?.sub ?? null,
      actorRole: session?.role ?? null,
      metadata: buildAuditMetadata(url, operation),
      method,
      operation,
      outcome: classifyAuditOutcome(statusCode),
      path: url.pathname,
      requestId: context.requestId,
      requestIpHash: hashAuditHeader(readRequestSource(request)),
      statusCode,
      targetId: descriptor.targetId,
      targetType: descriptor.targetType,
      userAgentHash: hashAuditHeader(readHeaderValue(request.headers["user-agent"]))
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("Audit event write failed", error);
    }
  }
}

/**
 * Classifies unsafe HTTP requests into audit action and target metadata.
 */
function describeAuditableRequest(method: string, url: URL): AuditRouteDescriptor | null {
  const isMutation = method === "POST" || method === "PATCH" || method === "DELETE";
  // Asset downloads are audited on GET too so we record every attempt against
  // restricted or ITAR-controlled documents, including denials and acknowledged
  // successes. The gate logic itself lives in handleAssetDownload.
  const isAuditableGet = method === "GET" && /^\/parts\/[^/]+\/assets\/[^/]+\/download$/u.test(url.pathname);

  if (!isMutation && !isAuditableGet) {
    return null;
  }

  const operation = classifyRouteOperation(method, url.pathname);
  const action = operation.replace(/^api-/u, "").replace(/-/gu, ".");
  const target = classifyAuditTarget(url.pathname);

  return {
    action,
    targetId: target.targetId,
    targetType: target.targetType
  };
}

/**
 * Extracts a route target from known API paths without reading request bodies.
 */
function classifyAuditTarget(pathname: string): { targetType: AuditEventTargetType; targetId: string | null } {
  const checks: Array<{ pattern: RegExp; targetType: AuditEventTargetType; idIndex: number }> = [
    { idIndex: 2, pattern: /^\/parts\/([^/]+)\/assets\/([^/]+)\/download$/u, targetType: "asset" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/reviews$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/asset-promotions$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/generation-requests$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/document-revisions$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/document-revisions\/([^/]+)\/redlines$/u, targetType: "document_revision" },
    { idIndex: 1, pattern: /^\/document-redlines\/([^/]+)$/u, targetType: "document_revision" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/issues\/([^/]+)\/workflow$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/source-reconciliation$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/parts\/([^/]+)\/substitutions$/u, targetType: "part" },
    { idIndex: 1, pattern: /^\/substitutions\/([^/]+)\/revoke$/u, targetType: "substitution" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)$/u, targetType: "project" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/bom-imports$/u, targetType: "project" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/follow-ups$/u, targetType: "project" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/files\/([^/]+)$/u, targetType: "project" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/export-bundles$/u, targetType: "project" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/approval-batch$/u, targetType: "project" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/circuit-block-instantiations$/u, targetType: "project" },
    { idIndex: 2, pattern: /^\/projects\/([^/]+)\/revisions\/([^/]+)$/u, targetType: "project_revision" },
    { idIndex: 1, pattern: /^\/projects\/([^/]+)\/revision-approval-gates$/u, targetType: "project_revision_approval_gate" },
    { idIndex: 1, pattern: /^\/bom-imports\/([^/]+)\/match$/u, targetType: "bom_import" },
    { idIndex: 1, pattern: /^\/evidence-attachments\/([^/]+)$/u, targetType: "evidence_attachment" },
    { idIndex: 1, pattern: /^\/follow-ups\/([^/]+)$/u, targetType: "follow_up" },
    { idIndex: 1, pattern: /^\/circuit-blocks\/([^/]+)$/u, targetType: "circuit_block" },
    { idIndex: 1, pattern: /^\/circuit-blocks\/([^/]+)\/parts$/u, targetType: "circuit_block" },
    { idIndex: 2, pattern: /^\/circuit-blocks\/([^/]+)\/parts\/([^/]+)$/u, targetType: "circuit_block_part" },
    { idIndex: 1, pattern: /^\/circuit-blocks\/([^/]+)\/follow-ups$/u, targetType: "circuit_block" },
    { idIndex: 1, pattern: /^\/provider-acquisition-jobs\/([^/]+)$/u, targetType: "provider_acquisition_job" },
    { idIndex: 1, pattern: /^\/vendors\/([^/]+)\/files\/([^/]+)$/u, targetType: "vendor" }
  ];

  if (pathname === "/projects") return { targetId: null, targetType: "project" };
  if (pathname === "/evidence-attachments" || pathname === "/evidence-attachments/files") return { targetId: null, targetType: "evidence_attachment" };
  if (pathname === "/circuit-blocks") return { targetId: null, targetType: "circuit_block" };
  if (pathname === "/imports/provider") return { targetId: null, targetType: "provider_import" };
  if (pathname === "/provider-acquisition-jobs") return { targetId: null, targetType: "provider_acquisition_job" };
  if (pathname === "/vendors") return { targetId: null, targetType: "vendor" };

  for (const check of checks) {
    const match = check.pattern.exec(pathname);
    const rawId = match?.[check.idIndex];
    if (rawId) {
      return { targetId: decodeURIComponent(rawId), targetType: check.targetType };
    }
  }

  return { targetId: null, targetType: "api_route" };
}

/**
 * Builds safe audit metadata from route-level facts only.
 */
function buildAuditMetadata(url: URL, operation: string): AuditEventMetadata {
  const queryKeys = Array.from(new Set(Array.from(url.searchParams.keys()))).sort();

  return {
    operation,
    queryKeys
  };
}

/**
 * Converts status codes into audit outcomes without inferring business approval.
 */
function classifyAuditOutcome(statusCode: number): "succeeded" | "failed" | "denied" {
  if (statusCode === 401 || statusCode === 403) {
    return "denied";
  }
  if (statusCode >= 400) {
    return "failed";
  }
  return "succeeded";
}

/**
 * Reads a client-supplied request id only if it is compact and header-safe.
 */
function readRequestId(value: string | string[] | undefined): string | null {
  const raw = readHeaderValue(value);
  if (!raw || !/^[A-Za-z0-9._:-]{8,128}$/u.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * Reads the best available request source string for hashing.
 */
function readRequestSource(request: IncomingMessage): string | null {
  return readHeaderValue(request.headers["x-forwarded-for"]) ?? request.socket?.remoteAddress ?? null;
}

/**
 * Normalizes a possibly repeated HTTP header to one compact string.
 */
function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/**
 * Hashes source-identifying request headers so the audit log can correlate requests without storing raw IP or UA values.
 */
function hashAuditHeader(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex");
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
  if (method === "GET" && pathname === "/where-used") return "api-where-used-search";
  if (method === "GET" && pathname === "/audit-events") return "api-audit-events-read";
  if (method === "GET" && pathname === "/connector-sets") return "api-connector-set-list";
  if (method === "POST" && pathname === "/connector-sets/resolve") return "api-connector-set-intent-resolve";
  if (method === "GET" && /^\/projects\/[^/]+\/approval-candidates$/u.test(pathname)) return "api-approval-batch-candidates";
  if (method === "POST" && /^\/projects\/[^/]+\/approval-batch$/u.test(pathname)) return "api-approval-batch-apply";
  if (method === "GET" && pathname === "/projects") return "api-project-list";
  if (method === "GET" && pathname === "/projects/health-summary") return "api-project-fleet-risk";
  if (method === "POST" && pathname === "/projects") return "api-project-create";
  if (method === "PATCH" && /^\/projects\/[^/]+$/u.test(pathname)) return "api-project-update";
  if (method === "GET" && /^\/projects\/[^/]+\/revisions$/u.test(pathname)) return "api-project-revisions";
  if (method === "GET" && /^\/projects\/[^/]+\/revisions\/compare$/u.test(pathname)) return "api-project-revision-compare";
  if (method === "GET" && /^\/projects\/[^/]+\/revision-approval-gates$/u.test(pathname)) return "api-project-revision-approval-gates-read";
  if (method === "POST" && /^\/projects\/[^/]+\/revision-approval-gates$/u.test(pathname)) return "api-project-revision-approval-gate-apply";
  if (method === "PATCH" && /^\/projects\/[^/]+\/revisions\/[^/]+$/u.test(pathname)) return "api-project-revision-update";
  if (method === "GET" && /^\/projects\/[^/]+\/bom-imports$/u.test(pathname)) return "api-project-bom-imports";
  if (method === "POST" && /^\/projects\/[^/]+\/bom-imports$/u.test(pathname)) return "api-bom-import-create";
  if (method === "GET" && /^\/projects\/[^/]+\/usages$/u.test(pathname)) return "api-project-usages";
  if (method === "GET" && /^\/projects\/[^/]+\/bom-health$/u.test(pathname)) return "api-project-bom-health";
  if (method === "GET" && /^\/projects\/[^/]+\/evidence$/u.test(pathname)) return "api-project-evidence";
  if (method === "GET" && /^\/projects\/[^/]+\/follow-ups$/u.test(pathname)) return "api-project-follow-ups";
  if (method === "POST" && /^\/projects\/[^/]+\/follow-ups$/u.test(pathname)) return "api-project-follow-ups-sync";
  if (method === "GET" && /^\/projects\/[^/]+\/files$/u.test(pathname)) return "api-project-files";
  if (method === "POST" && /^\/projects\/[^/]+\/files\/[^/]+$/u.test(pathname)) return "api-project-file-upload";
  if (method === "GET" && pathname === "/vendors") return "api-vendor-list";
  if (method === "POST" && pathname === "/vendors") return "api-vendor-create";
  if (method === "GET" && /^\/vendors\/[^/]+$/u.test(pathname)) return "api-vendor-detail";
  if (method === "POST" && /^\/vendors\/[^/]+\/files\/[^/]+$/u.test(pathname)) return "api-vendor-file-upload";
  if (method === "GET" && /^\/projects\/[^/]+$/u.test(pathname)) return "api-project-detail";
  if (method === "GET" && /^\/bom-imports\/[^/]+\/lines$/u.test(pathname)) return "api-bom-import-lines";
  if (method === "POST" && pathname === "/bom-imports/preview") return "api-bom-import-preview";
  if (method === "POST" && /^\/bom-imports\/[^/]+\/match$/u.test(pathname)) return "api-bom-import-match";
  if (method === "GET" && pathname === "/evidence-attachments") return "api-evidence-attachments";
  if (method === "POST" && pathname === "/evidence-attachments") return "api-evidence-attachment-create";
  if (method === "POST" && pathname === "/evidence-attachments/files") return "api-evidence-file-upload";
  if (method === "PATCH" && /^\/evidence-attachments\/[^/]+$/u.test(pathname)) return "api-evidence-attachment-update";
  if (method === "GET" && pathname === "/circuit-blocks") return "api-circuit-block-list";
  if (method === "POST" && pathname === "/circuit-blocks") return "api-circuit-block-create";
  if (method === "PATCH" && /^\/circuit-blocks\/[^/]+$/u.test(pathname)) return "api-circuit-block-update";
  if (method === "GET" && /^\/circuit-blocks\/[^/]+$/u.test(pathname)) return "api-circuit-block-detail";
  if (method === "GET" && /^\/circuit-blocks\/[^/]+\/follow-ups$/u.test(pathname)) return "api-circuit-block-follow-ups";
  if (method === "POST" && /^\/circuit-blocks\/[^/]+\/follow-ups$/u.test(pathname)) return "api-circuit-block-follow-ups-sync";
  if (method === "POST" && /^\/circuit-blocks\/[^/]+\/parts$/u.test(pathname)) return "api-circuit-block-part-create";
  if (method === "PATCH" && /^\/circuit-blocks\/[^/]+\/parts\/[^/]+$/u.test(pathname)) return "api-circuit-block-part-update";
  if (method === "POST" && /^\/circuit-blocks\/[^/]+\/known-risks$/u.test(pathname)) return "api-circuit-block-known-risk-create";
  if (method === "POST" && /^\/circuit-blocks\/[^/]+\/known-risks\/[^/]+\/resolve$/u.test(pathname)) return "api-circuit-block-known-risk-resolve";
  if (method === "POST" && /^\/projects\/[^/]+\/circuit-block-instantiations$/u.test(pathname)) return "api-circuit-block-instantiation-create";
  if (method === "GET" && /^\/parts\/[^/]+\/substitutions$/u.test(pathname)) return "api-part-substitutions-read";
  if (method === "POST" && /^\/parts\/[^/]+\/substitutions$/u.test(pathname)) return "api-part-substitution-create";
  if (method === "POST" && /^\/substitutions\/[^/]+\/revoke$/u.test(pathname)) return "api-part-substitution-revoke";
  if (method === "PATCH" && /^\/follow-ups\/[^/]+$/u.test(pathname)) return "api-follow-up-update";
  if (method === "GET" && /^\/storage\/.+$/u.test(pathname)) return "api-storage-serve";
  if (method === "GET" && /^\/parts\/[^/]+\/assets\/[^/]+\/download$/u.test(pathname)) return "api-asset-download";
  if (method === "GET" && /^\/parts\/[^/]+\/usages$/u.test(pathname)) return "api-part-where-used";
  if (method === "GET" && /^\/parts\/[^/]+\/supply-offers$/u.test(pathname)) return "api-part-supply-offers";
  if (method === "GET" && /^\/parts\/[^/]+\/document-revisions$/u.test(pathname)) return "api-document-revisions-read";
  if (method === "POST" && /^\/parts\/[^/]+\/document-revisions$/u.test(pathname)) return "api-document-revision-create";
  if (method === "POST" && /^\/document-revisions\/[^/]+\/redlines$/u.test(pathname)) return "api-document-redline-create";
  if (method === "PATCH" && /^\/document-redlines\/[^/]+$/u.test(pathname)) return "api-document-redline-update";
  if (method === "GET" && /^\/parts\/[^/]+$/u.test(pathname)) return "api-part-detail";
  if (method === "POST" && pathname === "/provider-lookups") return "api-provider-lookup";
  if (method === "POST" && pathname === "/provider-acquisition-jobs") return "api-provider-acquisition-job-create";
  if (method === "GET" && /^\/provider-acquisition-jobs\/[^/]+$/u.test(pathname)) return "api-provider-acquisition-job-read";
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
    ...buildAuditHeaders(response),
    ...buildTelemetryHeaders(response, statusCode)
  });
  response.end(JSON.stringify(payload, null, 2));
}

/**
 * Sends an HTTP 302 redirect to the given URL with telemetry headers.
 */
function sendRedirect(response: ServerResponse, url: string): void {
  response.writeHead(302, {
    Location: url,
    ...buildAuditHeaders(response),
    ...buildTelemetryHeaders(response, 302)
  });
  response.end();
}

/**
 * Adds the current request id to API responses when audit context exists.
 */
function buildAuditHeaders(response: ServerResponse): Record<string, string> {
  const context = requestAuditContexts.get(response);

  return context ? { "X-EE-Request-Id": context.requestId } : {};
}

/**
 * Sends a typed catalog data envelope with optional degraded-state warnings.
 */
function sendCatalogJson<TData>(response: ServerResponse, data: TData, source: CatalogDataSource, warnings?: string[], pagination?: SearchPagination): void {
  sendCatalogJsonWithStatus(response, 200, data, source, warnings, pagination);
}

/**
 * Sends a typed catalog data envelope with a caller-selected success status code.
 */
function sendCatalogJsonWithStatus<TData>(
  response: ServerResponse,
  statusCode: number,
  data: TData,
  source: CatalogDataSource,
  warnings?: string[],
  pagination?: SearchPagination
): void {
  const payload: ApiEnvelope<TData> = {
    data,
    ...(pagination ? { pagination } : {}),
    source,
    ...(warnings && warnings.length > 0 ? { warnings } : {})
  };

  sendJson(response, statusCode, payload);
}

/**
 * Sends the standard project-memory not-configured response without seed fallback.
 */
function sendProjectMemoryNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "DB_NOT_CONFIGURED",
      message: "Project memory reads require a configured database so project, BOM, and usage state can be read."
    }
  });
}

/**
 * Sends the standard audit-log not-configured response without seed fallback.
 */
function sendAuditLogNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "DB_NOT_CONFIGURED",
      message: "Audit log reads require a configured database so user action history can be reviewed."
    }
  });
}

/**
 * Sends the standard document-control not-configured response without seed fallback.
 */
function sendDocumentControlNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "DB_NOT_CONFIGURED",
      message: "Document control requires a configured database so revision, ACL, and redline history can be persisted."
    }
  });
}

/**
 * Sends the standard supply-offer not-configured response without seed fallback.
 */
function sendSupplyOffersNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "DB_NOT_CONFIGURED",
      message: "Supply offers require a configured database so source-linked commercial snapshots can be read."
    }
  });
}

/**
 * Sends a standard project-memory 404 response for scoped project/BOM reads.
 */
function sendProjectMemoryNotFound(response: ServerResponse, code: string, message: string): void {
  sendJson(response, 404, {
    error: {
      code,
      message
    }
  });
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
 * Generates a synthetic BOM import for one circuit block instantiation, matching block parts to the catalog.
 */
async function handleCircuitBlockInstantiationCreate(request: IncomingMessage, response: ServerResponse, projectId: string, actor: string): Promise<void> {
  const body = await readJsonBody<CircuitBlockInstantiationCreateInput>(request);

  if (!body || typeof body.circuitBlockId !== "string" || typeof body.projectRevisionId !== "string") {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CIRCUIT_BLOCK_INSTANTIATION_REQUEST",
        message: "Body requires circuitBlockId and projectRevisionId strings."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "circuit-block-instantiation-create",
      () => instantiateCircuitBlockIntoProjectBomInDatabase(projectId, body, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: result.code, message: result.message } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Persists one engineering-signed-off part substitution against a catalog part.
 */
async function handlePartSubstitutionCreate(request: IncomingMessage, response: ServerResponse, partId: string, actor: string): Promise<void> {
  const body = await readJsonBody<PartSubstitutionCreateInput>(request);

  if (!body || typeof body.substitutePartId !== "string" || (body.scope !== "global" && body.scope !== "project")) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_PART_SUBSTITUTION_REQUEST",
        message: "Body requires substitutePartId and scope ('global' or 'project')."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(
      response,
      "part-substitution-create",
      () => createPartSubstitutionInDatabase(partId, body, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") { sendProjectMemoryNotConfigured(response); return; }
    if (result.status === "not_found") { sendJson(response, 404, { error: { code: result.code, message: result.message } }); return; }
    if (result.status === "invalid") { sendJson(response, 400, { error: { code: result.code, message: result.message } }); return; }
    if (result.status === "conflict") { sendJson(response, 409, { error: { code: "PART_SUBSTITUTION_CONFLICT", message: result.message } }); return; }

    sendCatalogJsonWithStatus(response, 201, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Reads active and revoked substitution history for one catalog part.
 */
async function handlePartSubstitutionsRead(response: ServerResponse, partId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "part-substitutions-read",
      () => readPartSubstitutionsForPartFromDatabase(partId),
      (value) => value.status
    );

    if (result.status === "not_configured") { sendProjectMemoryNotConfigured(response); return; }
    if (result.status === "not_found") { sendProjectMemoryNotFound(response, "PART_NOT_FOUND", "Part not found."); return; }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Revokes one previously-approved substitution while preserving history for audit.
 */
async function handlePartSubstitutionRevoke(response: ServerResponse, substitutionId: string, actor: string): Promise<void> {
  try {
    const result = await timeRouteOperation(
      response,
      "part-substitution-revoke",
      () => revokePartSubstitutionInDatabase(substitutionId, actor),
      (value) => value.status
    );

    if (result.status === "not_configured") { sendProjectMemoryNotConfigured(response); return; }
    if (result.status === "not_found") { sendProjectMemoryNotFound(response, "PART_SUBSTITUTION_NOT_FOUND", "Substitution not found."); return; }
    if (result.status === "invalid") { sendJson(response, 400, { error: { code: result.code, message: result.message } }); return; }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Creates a manifest-first export bundle for all verified parts in a project.
 */
async function handleExportBundleCreate(request: IncomingMessage, response: ServerResponse, projectId: string, actor: string): Promise<void> {
  const body = await readJsonBody<ExportBundleCreateInput>(request);

  const validFormats: ExportBundleFormat[] = ["altium", "solidworks", "neutral"];

  if (!body || !validFormats.includes(body.bundleFormat as ExportBundleFormat)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_EXPORT_BUNDLE_REQUEST",
        message: "Export bundle requires bundleFormat: altium, solidworks, or neutral."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "export-bundle-create", () => createExportBundleInDatabase(projectId, body, actor, getStorageClient()), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Lists export bundles for one project.
 */
async function handleExportBundlesRead(response: ServerResponse, projectId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(response, "export-bundles-read", () => readExportBundlesFromDatabase(projectId, getStorageClient()), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendProjectMemoryNotFound(response, "PROJECT_NOT_FOUND", "Project not found.");
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Reads match-status diagnostics for one BOM import.
 */
async function handleBomImportDiagnosticsRead(response: ServerResponse, importId: string): Promise<void> {
  try {
    const result = await timeRouteOperation(response, "bom-diagnostics-read", () => readBomImportDiagnosticsFromDatabase(importId), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: "BOM_IMPORT_NOT_FOUND", message: "BOM import not found." } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
}

/**
 * Compares two BOM imports side-by-side for a project revision diff.
 */
async function handleBomRevisionCompareRead(response: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  const importId1 = url.searchParams.get("importId1");
  const importId2 = url.searchParams.get("importId2");

  if (!projectId || !importId1 || !importId2) {
    sendJson(response, 400, {
      error: {
        code: "BOM_COMPARE_PARAMS_REQUIRED",
        message: "BOM compare requires projectId, importId1, and importId2 query parameters."
      }
    });
    return;
  }

  try {
    const result = await timeRouteOperation(response, "bom-compare-read", () => readBomRevisionCompareFromDatabase(projectId, importId1, importId2), (value) => value.status);

    if (result.status === "not_configured") {
      sendProjectMemoryNotConfigured(response);
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, { error: { code: "BOM_IMPORTS_NOT_FOUND", message: "One or both BOM imports were not found in this project." } });
      return;
    }

    if (result.status === "invalid") {
      sendJson(response, 400, { error: { code: result.code, message: result.message } });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
  }
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
  // Refuse to bind the network port without a strong AUTH_SECRET — silently coercing a missing
  // secret to "" would let any forged HS256 token pass verification.
  assertAuthSecretConfigured();

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
