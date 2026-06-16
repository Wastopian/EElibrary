/**
 * File header: Provides the web app's provider-neutral API access layer.
 */

import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  ApprovalBatchCandidatesResponse,
  ApprovalBatchRequest,
  ApprovalBatchResponse,
  AuditEventListResponse,
  AssetPromotionInput,
  AssetPromotionResponse,
  BomImportCreateInput,
  BomImportCreateResponse,
  BomImportDiagnosticsResponse,
  BomImportLinesResponse,
  BomImportMatchResponse,
  BomImportPreviewInput,
  BomImportPreviewResponse,
  BomRevisionCompareResponse,
  CircuitBlockCreateInput,
  CircuitBlockCreateResponse,
  CircuitBlockDetailResponse,
  CircuitBlockInstantiationCreateInput,
  CircuitBlockInstantiationCreateResponse,
  CircuitBlockKnownRiskCreateInput,
  CircuitBlockKnownRiskMutationResponse,
  CircuitBlockKnownRiskResolveInput,
  PartEngineeringRecordCreateInput,
  PartEngineeringRecordListResponse,
  PartEngineeringRecordDraftDecisionInput,
  PartEngineeringRecordMutationResponse,
  PartEngineeringRecordResolveInput,
  CircuitBlockListFilters,
  CircuitBlockListResponse,
  CircuitBlockProjectDependency,
  CircuitBlockPartCreateInput,
  CircuitBlockPartCreateResponse,
  CircuitBlockPartUpdateInput,
  CircuitBlockPartUpdateResponse,
  CircuitBlockUpdateInput,
  CircuitBlockUpdateResponse,
  ConnectorClass,
  ConnectorSetIntentInput,
  ConnectorSetIntentResolution,
  ConnectorSetListResponse,
  DocumentRedlineCreateInput,
  DocumentRedlineCreateResponse,
  DocumentRedlineUpdateInput,
  DocumentRedlineUpdateResponse,
  DocumentRevisionCreateInput,
  DocumentRevisionCreateResponse,
  DocumentRevisionListResponse,
  EvidenceAttachmentCreateInput,
  EvidenceAttachmentCreateResponse,
  EvidenceAttachmentFileUploadInput,
  EvidenceAttachmentListFilters,
  EvidenceAttachmentListResponse,
  EvidenceAttachmentUpdateInput,
  EvidenceAttachmentUpdateResponse,
  ExportBundleCreateInput,
  ExportBundleCreateResponse,
  ExportBundleListResponse,
  ExportBundleVerifyResponse,
  FollowUpListResponse,
  FollowUpSyncResponse,
  FollowUpUpdateInput,
  FollowUpUpdateResponse,
  GenerationRequestCreateInput,
  GenerationRequestCreateResponse,
  GenerationTargetAssetType,
  PartDetailResponse,
  PartSubstitutionCreateInput,
  PartSubstitutionCreateResponse,
  PartSubstitutionListResponse,
  PartSubstitutionRevokeResponse,
  PartSupplyOffersResponse,
  PartWhereUsedResponse,
  PartIssueCode,
  PartIssueWorkflowUpdateInput,
  PartIssueWorkflowUpdateResponse,
  ProjectDetailResponse,
  ProjectBomHealthResponse,
  ProjectCreateInput,
  ProjectCreateResponse,
  ProjectEvidenceAttachmentsResponse,
  ProjectFilesResponse,
  ProjectFileUploadInput,
  ProjectFileUploadResponse,
  ProjectFleetRiskResponse,
  ProjectFolderCategory,
  ProjectFromCsvInput,
  ProjectFromCsvResponse,
  ProjectOverlapPanelResponse,
  ProjectListResponse,
  VendorCreateInput,
  VendorCreateResponse,
  VendorDetailResponse,
  VendorFileUploadInput,
  VendorFileUploadResponse,
  VendorFolderSection,
  VendorListResponse,
  ProjectRevisionCompareResponse,
  ProjectRevisionApprovalGateListResponse,
  ProjectRevisionApprovalGateRequest,
  ProjectRevisionApprovalGateResponse,
  ProjectRevisionUpdateInput,
  ProjectRevisionUpdateResponse,
  ProjectUpdateInput,
  ProjectUpdateResponse,
  PartSearchFilters,
  PartSearchRecord,
  ProviderAcquisitionJobCreateInput,
  ProviderAcquisitionJobDetailResponse,
  ProviderLookupCandidate,
  ProviderLookupRequestInput,
  ProviderImportCreateInput,
  ProviderImportCreateResponse,
  ReviewActionInput,
  ReviewActionResponse,
  SourceReconciliationUpdateInput,
  SourceReconciliationUpdateResponse,
  SearchFacets,
  WhereUsedSearchResponse,
  WhereUsedTargetType
} from "@ee-library/shared/types";
import type { SystemHealthResponse } from "@ee-library/shared/system-health-types";

/** ApiHealth describes the lightweight operational status response from the API. */
export interface ApiHealth {
  /** Dependency status values are deliberately plain strings from the API boundary. */
  dependencies: {
    database: "connected" | "not_configured" | "unavailable";
    objectStorage: string;
    queue: string;
  };
  /** Service name returned by the API. */
  service: string;
  /** Top-level health label returned by the API. */
  status: string;
}

/** ApiClientError preserves machine-readable API error details for route-level recovery UI. */
export class ApiClientError extends Error {
  /** User-facing API action that failed. */
  readonly action: string;
  /** Machine-readable API error code. */
  readonly code: string;
  /** Optional structured payload from the API error envelope (e.g. suggestedMapping). */
  readonly details: Record<string, unknown>;
  /** HTTP status returned by the API. */
  readonly statusCode: number;

  /**
   * Creates a typed API error with enough detail for setup and degraded-state rendering.
   * The details map carries any additional fields the API surfaced on the error envelope so
   * route-level recovery copy can render specific guidance (e.g. missing-MPN-mapping headers).
   */
  constructor(action: string, statusCode: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(`${action} failed (${code}): ${message}`);
    this.name = "ApiClientError";
    this.action = action;
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

/**
 * Checks whether an unknown failure carries API error metadata.
 */
export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/**
 * Fetches provider-neutral search facets from the API boundary.
 */
export async function fetchSearchFacets(): Promise<SearchFacets> {
  const envelope = await fetchSearchFacetsEnvelope();

  return envelope.data;
}

/**
 * Fetches search facets and preserves catalog source metadata.
 */
export async function fetchSearchFacetsEnvelope(filters: PartSearchFilters = {}): Promise<ApiEnvelope<SearchFacets>> {
  const searchParams = new URLSearchParams();

  appendSearchParam(searchParams, "q", filters.query);
  appendSearchParam(searchParams, "manufacturerId", filters.manufacturerId);
  appendSearchParam(searchParams, "category", filters.category);
  appendSearchParam(searchParams, "packageId", filters.packageId);
  appendSearchParam(searchParams, "lifecycleStatus", filters.lifecycleStatus);
  appendSearchParam(searchParams, "cad", filters.cadAvailability === "any" ? undefined : filters.cadAvailability);
  appendSearchParam(searchParams, "providerPartId", filters.providerPartId);
  appendSearchParam(searchParams, "providerUrl", filters.providerUrl);
  appendSearchParam(searchParams, "datasheetUrl", filters.datasheetUrl);
  appendSearchParam(searchParams, "readinessStatus", filters.readinessStatus);
  appendSearchParam(searchParams, "approvalStatus", filters.approvalStatus);
  appendSearchParam(searchParams, "connectorClass", filters.connectorClass);
  const query = searchParams.toString();

  return fetchApi<ApiEnvelope<SearchFacets>>(`/parts/facets${query ? `?${query}` : ""}`);
}

/**
 * Fetches search results from the API boundary.
 */
export async function fetchPartSearch(filters: PartSearchFilters): Promise<PartSearchRecord[]> {
  const envelope = await fetchPartSearchEnvelope(filters);

  return envelope.data;
}

/**
 * Fetches search records and preserves catalog source metadata.
 */
export async function fetchPartSearchEnvelope(filters: PartSearchFilters): Promise<ApiEnvelope<PartSearchRecord[]>> {
  const searchParams = new URLSearchParams();

  appendSearchParam(searchParams, "q", filters.query);
  appendSearchParam(searchParams, "manufacturerId", filters.manufacturerId);
  appendSearchParam(searchParams, "category", filters.category);
  appendSearchParam(searchParams, "packageId", filters.packageId);
  appendSearchParam(searchParams, "lifecycleStatus", filters.lifecycleStatus);
  appendSearchParam(searchParams, "cad", filters.cadAvailability === "any" ? undefined : filters.cadAvailability);
  appendSearchParam(searchParams, "providerPartId", filters.providerPartId);
  appendSearchParam(searchParams, "providerUrl", filters.providerUrl);
  appendSearchParam(searchParams, "datasheetUrl", filters.datasheetUrl);
  appendSearchParam(searchParams, "readinessStatus", filters.readinessStatus);
  appendSearchParam(searchParams, "approvalStatus", filters.approvalStatus);
  appendSearchParam(searchParams, "connectorClass", filters.connectorClass);
  appendSearchParam(searchParams, "page", filters.page && filters.page > 1 ? filters.page.toString() : undefined);
  appendSearchParam(searchParams, "pageSize", filters.pageSize && filters.pageSize !== 20 ? filters.pageSize.toString() : undefined);
  appendSearchParam(searchParams, "sort", filters.sort && filters.sort !== "mpn_asc" ? filters.sort : undefined);

  const query = searchParams.toString();

  return fetchApi<ApiEnvelope<PartSearchRecord[]>>(`/parts${query ? `?${query}` : ""}`);
}

/**
 * Fetches API health for homepage status without failing the whole page if the API is down.
 */
export async function fetchApiHealth(): Promise<ApiHealth | null> {
  try {
    return await fetchApi<ApiHealth>("/health");
  } catch {
    return null;
  }
}

/**
 * Fetches the system-health payload that drives the WorkerStatusBanner. Returns null on
 * transport failure so the landing page can render an "API unreachable" state without
 * crashing.
 */
export async function fetchSystemHealth(): Promise<SystemHealthResponse | null> {
  try {
    return await fetchApi<SystemHealthResponse>("/system/health");
  } catch {
    return null;
  }
}

/**
 * Fetches the read-only project-memory list envelope so pages can render source state honestly.
 */
export async function fetchProjectListEnvelope(): Promise<ApiEnvelope<ProjectListResponse>> {
  return fetchApi<ApiEnvelope<ProjectListResponse>>("/projects");
}

/**
 * Fetches the read-only project-memory list without hiding planned capability states.
 */
export async function fetchProjectList(): Promise<ProjectListResponse> {
  const envelope = await fetchProjectListEnvelope();

  return envelope.data;
}

/**
 * Fetches the cross-project risk dashboard with explainable counts only.
 */
export async function fetchProjectFleetRisk(): Promise<ProjectFleetRiskResponse> {
  const envelope = await fetchApi<ApiEnvelope<ProjectFleetRiskResponse>>("/projects/health-summary");
  return envelope.data;
}

/**
 * Creates a DB-backed project memory root and first revision.
 */
export async function createProject(input: ProjectCreateInput): Promise<ProjectCreateResponse> {
  const response = await fetch(buildApiUrl("/projects"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Project create");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectCreateResponse>;

  return envelope.data;
}

/**
 * Creates a project, persists the dropped CSV/XLSX as a BOM import, and runs
 * deterministic matching in one chained call so day-zero onboarding can land on
 * the diagnostics view in a single click. Errors carry structured details
 * (e.g. suggestedMapping/headers for missing MPN columns) so the calling page
 * can render targeted recovery copy instead of a generic failure message.
 */
export async function createProjectFromCsv(input: ProjectFromCsvInput): Promise<ProjectFromCsvResponse> {
  const response = await fetch(buildApiUrl("/projects/from-csv"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Project from CSV");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectFromCsvResponse>;

  return envelope.data;
}

/**
 * Updates project metadata while keeping BOM, approval, validation, and export state separate.
 */
export async function updateProject(projectId: string, input: ProjectUpdateInput): Promise<ProjectUpdateResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Project update");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectUpdateResponse>;

  return envelope.data;
}

/**
 * Updates revision metadata without remapping BOM rows or creating usage records.
 */
export async function updateProjectRevision(projectId: string, revisionId: string, input: ProjectRevisionUpdateInput): Promise<ProjectRevisionUpdateResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Project revision update");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectRevisionUpdateResponse>;

  return envelope.data;
}

/**
 * Fetches one project-memory detail record from the API boundary.
 */
export async function fetchProjectDetail(projectId: string): Promise<ProjectDetailResponse | null> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Project detail request");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectDetailResponse>;

  return envelope.data;
}

/**
 * Fetches the project file mirror listing (parts list, datasheets, 3D models) for one project.
 *
 * Returns null on 404 so the project detail page can still render when the API does not
 * persist the project. Other API errors propagate as ApiClientError values so the caller
 * can decide whether to suppress, surface, or retry.
 */
export async function fetchProjectFiles(projectId: string): Promise<ProjectFilesResponse | null> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/files`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Project file mirror request");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectFilesResponse>;

  return envelope.data;
}

/**
 * Uploads one file or note to the project file mirror for the requested category.
 *
 * The transport mirrors the evidence upload pattern: JSON body with either
 * `contentBase64` (binary) or `content` (UTF-8 text). The web app picks the right form
 * based on the active card — file inputs base64-encode; the notes composer sends text.
 */
export async function uploadProjectFile(
  projectId: string,
  category: ProjectFolderCategory,
  input: ProjectFileUploadInput
): Promise<ProjectFileUploadResponse> {
  const response = await fetch(
    buildApiUrl(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(category)}`),
    {
      body: JSON.stringify(input),
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw await buildApiError(response, "Project file upload");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectFileUploadResponse>;
  return envelope.data;
}

/**
 * Fetches the vendor notebook list (every supplier with note and file counts).
 *
 * Returns the raw response (not just `.vendors`) so callers can render the appropriate
 * setup state when the vendor mirror is disabled or unreachable on the API host.
 */
export async function fetchVendorList(): Promise<VendorListResponse> {
  const response = await fetch(buildApiUrl("/vendors"), { cache: "no-store" });

  if (!response.ok) {
    throw await buildApiError(response, "Vendor list");
  }

  const envelope = (await response.json()) as ApiEnvelope<VendorListResponse>;
  return envelope.data;
}

/**
 * Fetches one vendor's detail bundle (metadata + notes/files folder listings).
 */
export async function fetchVendorDetail(slug: string): Promise<VendorDetailResponse> {
  const response = await fetch(buildApiUrl(`/vendors/${encodeURIComponent(slug)}`), { cache: "no-store" });

  if (!response.ok) {
    throw await buildApiError(response, "Vendor detail");
  }

  const envelope = (await response.json()) as ApiEnvelope<VendorDetailResponse>;
  return envelope.data;
}

/**
 * Creates a new vendor record by name + category. The API derives the slug, so the web
 * UI does not have to choose URLs — the response carries the canonical slug back.
 */
export async function createVendor(input: VendorCreateInput): Promise<VendorCreateResponse> {
  const response = await fetch(buildApiUrl("/vendors"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Vendor create");
  }

  const envelope = (await response.json()) as ApiEnvelope<VendorCreateResponse>;
  return envelope.data;
}

/**
 * Uploads one file or note to the vendor mirror under the requested section.
 *
 * Mirrors uploadProjectFile so the workspace surfaces feel consistent: file inputs
 * base64-encode, the inline notes composer sends UTF-8 text directly.
 */
export async function uploadVendorFile(
  slug: string,
  section: VendorFolderSection,
  input: VendorFileUploadInput
): Promise<VendorFileUploadResponse> {
  const response = await fetch(
    buildApiUrl(`/vendors/${encodeURIComponent(slug)}/files/${encodeURIComponent(section)}`),
    {
      body: JSON.stringify(input),
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw await buildApiError(response, "Vendor file upload");
  }

  const envelope = (await response.json()) as ApiEnvelope<VendorFileUploadResponse>;
  return envelope.data;
}

/**
 * Fetches explainable BOM health for one project.
 */
export async function fetchProjectBomHealth(projectId: string): Promise<ProjectBomHealthResponse | null> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/bom-health`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Project BOM health request");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectBomHealthResponse>;

  return envelope.data;
}

/**
 * Fetches evidence metadata attached to one project or its project-memory children.
 */
export async function fetchProjectEvidenceAttachments(projectId: string): Promise<ProjectEvidenceAttachmentsResponse | null> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/evidence`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Project evidence request");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectEvidenceAttachmentsResponse>;

  return envelope.data;
}

/**
 * Parses a CSV BOM through the API without creating database records.
 */
export async function previewBomImport(input: BomImportPreviewInput): Promise<BomImportPreviewResponse> {
  const response = await fetch(buildApiUrl("/bom-imports/preview"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "BOM import preview");
  }

  const envelope = (await response.json()) as ApiEnvelope<BomImportPreviewResponse>;

  return envelope.data;
}

/**
 * Persists a mapped CSV BOM into one project without running part matching.
 */
export async function createBomImport(projectId: string, input: BomImportCreateInput): Promise<BomImportCreateResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/bom-imports`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "BOM import create");
  }

  const envelope = (await response.json()) as ApiEnvelope<BomImportCreateResponse>;

  return envelope.data;
}

/**
 * Runs deterministic internal matching for one persisted BOM import.
 */
export async function matchBomImportRows(bomImportId: string): Promise<BomImportMatchResponse> {
  const response = await fetch(buildApiUrl(`/bom-imports/${encodeURIComponent(bomImportId)}/match`), {
    body: JSON.stringify({}),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "BOM import match");
  }

  const envelope = (await response.json()) as ApiEnvelope<BomImportMatchResponse>;

  return envelope.data;
}

/**
 * Fetches raw and mapped rows for one persisted BOM import.
 */
export async function fetchBomImportLines(bomImportId: string): Promise<BomImportLinesResponse | null> {
  const response = await fetch(buildApiUrl(`/bom-imports/${encodeURIComponent(bomImportId)}/lines`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "BOM import lines request");
  }

  const envelope = (await response.json()) as ApiEnvelope<BomImportLinesResponse>;

  return envelope.data;
}

/**
 * Persists one evidence attachment metadata row without implying validation or approval.
 */
export async function createEvidenceAttachment(input: EvidenceAttachmentCreateInput): Promise<EvidenceAttachmentCreateResponse> {
  const response = await fetch(buildApiUrl("/evidence-attachments"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Evidence attachment create");
  }

  const envelope = (await response.json()) as ApiEnvelope<EvidenceAttachmentCreateResponse>;

  return envelope.data;
}

/**
 * Fetches global evidence vault rows with provider-neutral filters.
 */
export async function fetchEvidenceAttachments(filters: EvidenceAttachmentListFilters = {}): Promise<EvidenceAttachmentListResponse> {
  const searchParams = new URLSearchParams();

  appendSearchParam(searchParams, "targetType", filters.targetType ?? undefined);
  appendSearchParam(searchParams, "evidenceType", filters.evidenceType ?? undefined);
  appendSearchParam(searchParams, "reviewStatus", filters.reviewStatus ?? undefined);
  appendSearchParam(searchParams, "storageState", filters.storageState ?? undefined);
  appendSearchParam(searchParams, "sourceSystem", filters.sourceSystem ?? undefined);
  appendSearchParam(searchParams, "q", filters.query ?? undefined);

  const query = searchParams.toString();
  const envelope = await fetchApi<ApiEnvelope<EvidenceAttachmentListResponse>>(`/evidence-attachments${query ? `?${query}` : ""}`);

  return envelope.data;
}

/**
 * Uploads a local evidence file and persists file-backed evidence metadata.
 */
export async function uploadEvidenceAttachmentFile(input: EvidenceAttachmentFileUploadInput): Promise<EvidenceAttachmentCreateResponse> {
  const response = await fetch(buildApiUrl("/evidence-attachments/files"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Evidence file upload");
  }

  const envelope = (await response.json()) as ApiEnvelope<EvidenceAttachmentCreateResponse>;

  return envelope.data;
}

/**
 * Updates evidence review metadata without changing validation, approval, or export state.
 */
export async function updateEvidenceAttachment(evidenceAttachmentId: string, input: EvidenceAttachmentUpdateInput): Promise<EvidenceAttachmentUpdateResponse> {
  const response = await fetch(buildApiUrl(`/evidence-attachments/${encodeURIComponent(evidenceAttachmentId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Evidence attachment update");
  }

  const envelope = (await response.json()) as ApiEnvelope<EvidenceAttachmentUpdateResponse>;

  return envelope.data;
}

/**
 * Fetches project follow-up work generated from persisted BOM health findings.
 */
export async function fetchProjectFollowUps(projectId: string): Promise<FollowUpListResponse | null> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/follow-ups`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Project follow-ups request");
  }

  const envelope = (await response.json()) as ApiEnvelope<FollowUpListResponse>;

  return envelope.data;
}

/**
 * Reads the day-zero overlap panel payload for one project. Returns null when the
 * project is unknown so the panel can render its own empty/missing state without
 * blocking the rest of the page.
 *
 * Honesty: overlap data is a reuse *signal*, not an approval or trust signal; callers
 * must not interpret the response as anything beyond "these prior projects have
 * confirmed usage of N of the same parts."
 */
export async function fetchProjectOverlapPanel(projectId: string): Promise<ProjectOverlapPanelResponse | null> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/overlap`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Project overlap request");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectOverlapPanelResponse>;

  return envelope.data;
}

/**
 * Refreshes project follow-up records from current BOM health findings.
 */
export async function syncProjectFollowUps(projectId: string): Promise<FollowUpSyncResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/follow-ups`), {
    body: JSON.stringify({}),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Project follow-ups sync");
  }

  const envelope = (await response.json()) as ApiEnvelope<FollowUpSyncResponse>;

  return envelope.data;
}

/**
 * Fetches circuit block follow-up work generated from required role readiness gaps.
 */
/**
 * Fetches projects that have confirmed usages overlapping with a circuit block's part roles.
 */
export async function fetchCircuitBlockProjectDependencies(circuitBlockId: string): Promise<CircuitBlockProjectDependency[]> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/project-dependencies`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block project dependencies");
  }

  const envelope = (await response.json()) as ApiEnvelope<{ dependencies: CircuitBlockProjectDependency[] }>;

  return envelope.data.dependencies;
}

export async function fetchCircuitBlockFollowUps(circuitBlockId: string): Promise<FollowUpListResponse | null> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/follow-ups`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block follow-ups request");
  }

  const envelope = (await response.json()) as ApiEnvelope<FollowUpListResponse>;

  return envelope.data;
}

/**
 * Refreshes circuit block follow-up records from current required-role readiness gaps.
 */
export async function syncCircuitBlockFollowUps(circuitBlockId: string): Promise<FollowUpSyncResponse> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/follow-ups`), {
    body: JSON.stringify({}),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block follow-ups sync");
  }

  const envelope = (await response.json()) as ApiEnvelope<FollowUpSyncResponse>;

  return envelope.data;
}

/**
 * Updates a follow-up workflow row without mutating the source finding.
 */
export async function updateFollowUp(followUpId: string, input: FollowUpUpdateInput): Promise<FollowUpUpdateResponse> {
  const response = await fetch(buildApiUrl(`/follow-ups/${encodeURIComponent(followUpId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Follow-up update");
  }

  const envelope = (await response.json()) as ApiEnvelope<FollowUpUpdateResponse>;

  return envelope.data;
}

/**
 * Fetches the reusable circuit block library from project-memory persistence.
 *
 * Filters are forwarded as URL query parameters so the server can narrow the result set
 * directly. The server echoes the applied filters on the response so the UI can reflect
 * the actual filter state without keeping a separate client-side mirror.
 */
export async function fetchCircuitBlocks(
  filters: Partial<CircuitBlockListFilters> = {}
): Promise<CircuitBlockListResponse> {
  const query = new URLSearchParams();
  if (filters.query) query.set("q", filters.query);
  if (filters.blockType) query.set("type", filters.blockType);
  if (filters.status) query.set("status", filters.status);
  if (filters.owner) query.set("owner", filters.owner);
  if (filters.reuseReadiness) query.set("readiness", filters.reuseReadiness);

  const path = query.toString().length > 0 ? `/circuit-blocks?${query.toString()}` : "/circuit-blocks";
  const envelope = await fetchApi<ApiEnvelope<CircuitBlockListResponse>>(path);

  return envelope.data;
}

/**
 * Creates one structured circuit block without adding part roles.
 */
export async function createCircuitBlock(input: CircuitBlockCreateInput): Promise<CircuitBlockCreateResponse> {
  const response = await fetch(buildApiUrl("/circuit-blocks"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block create");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockCreateResponse>;

  return envelope.data;
}

/**
 * Updates circuit block metadata without changing linked-part approval or export truth.
 */
export async function updateCircuitBlock(circuitBlockId: string, input: CircuitBlockUpdateInput): Promise<CircuitBlockUpdateResponse> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block update");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockUpdateResponse>;

  return envelope.data;
}

/**
 * Fetches one circuit block detail with linked part roles and evidence.
 */
export async function fetchCircuitBlockDetail(circuitBlockId: string): Promise<CircuitBlockDetailResponse | null> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block detail request");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockDetailResponse>;

  return envelope.data;
}

/**
 * Adds or refreshes a part role inside one circuit block.
 */
export async function createCircuitBlockPart(circuitBlockId: string, input: CircuitBlockPartCreateInput): Promise<CircuitBlockPartCreateResponse> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/parts`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block part create");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockPartCreateResponse>;

  return envelope.data;
}

/**
 * Updates circuit block part-role metadata without changing the linked part identity.
 */
export async function updateCircuitBlockPart(circuitBlockId: string, circuitBlockPartId: string, input: CircuitBlockPartUpdateInput): Promise<CircuitBlockPartUpdateResponse> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/parts/${encodeURIComponent(circuitBlockPartId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block part update");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockPartUpdateResponse>;

  return envelope.data;
}

/**
 * Records one engineering-memory observation against a reusable circuit block. Recording a
 * known risk preserves design memory; it never approves any linked part or unlocks export.
 */
export async function createCircuitBlockKnownRisk(
  circuitBlockId: string,
  input: CircuitBlockKnownRiskCreateInput
): Promise<CircuitBlockKnownRiskMutationResponse> {
  const response = await fetch(buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/known-risks`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block known risk create");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockKnownRiskMutationResponse>;

  return envelope.data;
}

/**
 * Marks one known-risk row as resolved. The row is preserved (never deleted) so audits of
 * past reuses of this block remain consistent with the state at the time.
 */
export async function resolveCircuitBlockKnownRisk(
  circuitBlockId: string,
  knownRiskId: string,
  input: CircuitBlockKnownRiskResolveInput = {}
): Promise<CircuitBlockKnownRiskMutationResponse> {
  const response = await fetch(
    buildApiUrl(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}/known-risks/${encodeURIComponent(knownRiskId)}/resolve`),
    {
      body: JSON.stringify(input),
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block known risk resolve");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockKnownRiskMutationResponse>;

  return envelope.data;
}

/**
 * Fetches the full private engineering-memory history (open + resolved) for one catalog part.
 */
export async function fetchPartEngineeringRecords(partId: string): Promise<PartEngineeringRecordListResponse> {
  const envelope = await fetchApi<ApiEnvelope<PartEngineeringRecordListResponse>>(`/parts/${encodeURIComponent(partId)}/engineering-records`);
  return envelope.data;
}

/**
 * Records one piece of private engineering memory against a part. Recording never approves the
 * part, validates an asset, or unlocks export.
 */
export async function createPartEngineeringRecord(
  partId: string,
  input: PartEngineeringRecordCreateInput
): Promise<PartEngineeringRecordMutationResponse> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/engineering-records`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Part engineering record create");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartEngineeringRecordMutationResponse>;

  return envelope.data;
}

/**
 * Marks one engineering-memory record resolved. The row is preserved (never deleted) so audits
 * of past reuses of this part remain consistent with the state at the time.
 */
export async function resolvePartEngineeringRecord(
  partId: string,
  recordId: string,
  input: PartEngineeringRecordResolveInput = {}
): Promise<PartEngineeringRecordMutationResponse> {
  const response = await fetch(
    buildApiUrl(`/parts/${encodeURIComponent(partId)}/engineering-records/${encodeURIComponent(recordId)}/resolve`),
    {
      body: JSON.stringify(input),
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw await buildApiError(response, "Part engineering record resolve");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartEngineeringRecordMutationResponse>;

  return envelope.data;
}

/**
 * Confirms (accept into durable memory) or dismisses (reject, preserved for audit) one proposed
 * passive-capture engineering-memory draft.
 */
export async function decidePartEngineeringRecordDraft(
  partId: string,
  recordId: string,
  decision: "confirm" | "dismiss",
  input: PartEngineeringRecordDraftDecisionInput = {}
): Promise<PartEngineeringRecordMutationResponse> {
  const response = await fetch(
    buildApiUrl(`/parts/${encodeURIComponent(partId)}/engineering-records/${encodeURIComponent(recordId)}/${decision}`),
    {
      body: JSON.stringify(input),
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw await buildApiError(response, `Part engineering record ${decision}`);
  }

  const envelope = (await response.json()) as ApiEnvelope<PartEngineeringRecordMutationResponse>;

  return envelope.data;
}

/**
 * Fetches one component detail envelope from the API boundary.
 */
export async function fetchPartDetailEnvelope(partId: string): Promise<ApiEnvelope<PartDetailResponse> | null> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Part detail request");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartDetailResponse>;

  return envelope;
}

/**
 * Fetches one component detail record from the API boundary.
 */
export async function fetchPartDetail(partId: string): Promise<PartDetailResponse | null> {
  const envelope = await fetchPartDetailEnvelope(partId);

  return envelope?.data ?? null;
}

/**
 * Fetches confirmed where-used history for one internal part without changing detail truth.
 */
export async function fetchPartWhereUsed(partId: string): Promise<PartWhereUsedResponse | null> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/usages`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Part where-used request");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartWhereUsedResponse>;

  return envelope.data;
}

/**
 * Fetches source-linked supply offer snapshots for one part without implying live availability.
 */
export async function fetchPartSupplyOffers(partId: string): Promise<PartSupplyOffersResponse | null> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/supply-offers`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Part supply offers request");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartSupplyOffersResponse>;

  return envelope.data;
}

/**
 * Fetches controlled document revision history for one part without changing asset truth.
 */
export async function fetchPartDocumentRevisions(partId: string): Promise<DocumentRevisionListResponse | null> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/document-revisions`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildApiError(response, "Part document control request");
  }

  const envelope = (await response.json()) as ApiEnvelope<DocumentRevisionListResponse>;

  return envelope.data;
}

/**
 * Fetches global where-used search results for project-memory targets.
 */
export async function fetchWhereUsedSearch(targetType: WhereUsedTargetType, query: string): Promise<WhereUsedSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    targetType
  });
  const envelope = await fetchApi<ApiEnvelope<WhereUsedSearchResponse>>(`/where-used?${params.toString()}`);

  return envelope.data;
}

/**
 * Runs one provider catalog import through the API using the shared worker import path.
 */
export async function requestProviderImport(input: ProviderImportCreateInput): Promise<ProviderImportCreateResponse> {
  const response = await fetch(buildApiUrl("/imports/provider"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Provider import");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProviderImportCreateResponse>;

  return envelope.data;
}

/**
 * Runs an explicit exact-match provider candidate lookup without changing normal catalog search behavior.
 */
export async function requestProviderLookup(input: ProviderLookupRequestInput): Promise<ProviderLookupCandidate[]> {
  const response = await fetch(buildApiUrl("/provider-lookups"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Provider lookup");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProviderLookupCandidate[]>;

  return envelope.data;
}

/**
 * Creates one admin-gated provider acquisition job from an exact-match provider candidate.
 */
export async function requestProviderAcquisitionJob(input: ProviderAcquisitionJobCreateInput): Promise<ProviderAcquisitionJobDetailResponse> {
  const response = await fetch(buildApiUrl("/provider-acquisition-jobs"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Provider acquisition job");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProviderAcquisitionJobDetailResponse>;

  return envelope.data;
}

/**
 * Reads one admin-gated provider acquisition job for client polling.
 */
export async function fetchProviderAcquisitionJob(jobId: string): Promise<ProviderAcquisitionJobDetailResponse> {
  const response = await fetch(buildApiUrl(`/provider-acquisition-jobs/${encodeURIComponent(jobId)}`), {
    cache: "no-store",
    headers: await getAuthHeaders()
  });

  if (!response.ok) {
    throw await buildApiError(response, "Provider acquisition job");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProviderAcquisitionJobDetailResponse>;

  return envelope.data;
}

/**
 * Creates a DB-backed generation request through the API without simulating completion.
 */
export async function createGenerationRequest(partId: string, targetAssetType: GenerationTargetAssetType): Promise<GenerationRequestCreateResponse> {
  const body: GenerationRequestCreateInput = { targetAssetType };
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/generation-requests`), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Generation request");
  }

  const envelope = (await response.json()) as ApiEnvelope<GenerationRequestCreateResponse>;

  return envelope.data;
}

/**
 * Creates a DB-backed review action through the API without implying automatic export readiness.
 */
export async function createReviewAction(partId: string, input: ReviewActionInput): Promise<ReviewActionResponse> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/reviews`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Review action");
  }

  const envelope = (await response.json()) as ApiEnvelope<ReviewActionResponse>;

  return envelope.data;
}

/**
 * Explicitly promotes an approved asset into verified-for-export when rules allow it.
 */
export async function createAssetPromotion(partId: string, assetId: string): Promise<AssetPromotionResponse> {
  const body: AssetPromotionInput = { assetId };
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/asset-promotions`), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Asset promotion");
  }

  const envelope = (await response.json()) as ApiEnvelope<AssetPromotionResponse>;

  return envelope.data;
}

/**
 * Creates a controlled document revision from an existing part asset.
 */
export async function createDocumentRevision(partId: string, input: DocumentRevisionCreateInput): Promise<DocumentRevisionCreateResponse> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/document-revisions`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Document revision");
  }

  const envelope = (await response.json()) as ApiEnvelope<DocumentRevisionCreateResponse>;

  return envelope.data;
}

/**
 * Creates an engineering redline note for a controlled document revision.
 */
export async function createDocumentRedline(documentRevisionId: string, input: DocumentRedlineCreateInput): Promise<DocumentRedlineCreateResponse> {
  const response = await fetch(buildApiUrl(`/document-revisions/${encodeURIComponent(documentRevisionId)}/redlines`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Document redline");
  }

  const envelope = (await response.json()) as ApiEnvelope<DocumentRedlineCreateResponse>;

  return envelope.data;
}

/**
 * Updates the workflow state or note text for one engineering redline.
 */
export async function updateDocumentRedline(redlineId: string, input: DocumentRedlineUpdateInput): Promise<DocumentRedlineUpdateResponse> {
  const response = await fetch(buildApiUrl(`/document-redlines/${encodeURIComponent(redlineId)}`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "PATCH"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Document redline update");
  }

  const envelope = (await response.json()) as ApiEnvelope<DocumentRedlineUpdateResponse>;

  return envelope.data;
}

/**
 * Updates operator workflow state for one part issue through the API.
 */
export async function updatePartIssueWorkflow(
  partId: string,
  issueCode: PartIssueCode,
  input: PartIssueWorkflowUpdateInput
): Promise<PartIssueWorkflowUpdateResponse> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/issues/${encodeURIComponent(issueCode)}/workflow`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Issue workflow update");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartIssueWorkflowUpdateResponse>;

  return envelope.data;
}

/**
 * Updates source-conflict reconciliation state through the API.
 */
export async function updateSourceReconciliation(
  partId: string,
  input: SourceReconciliationUpdateInput
): Promise<SourceReconciliationUpdateResponse> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/source-reconciliation`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Source reconciliation update");
  }

  const envelope = (await response.json()) as ApiEnvelope<SourceReconciliationUpdateResponse>;

  return envelope.data;
}

type ServerCookieReader = () => Promise<string | null> | string | null;

let serverCookieReaderForTests: ServerCookieReader | null = null;

/**
 * Installs a cookie reader for focused tests of server-side API token minting.
 */
export function setApiClientServerCookieReaderForTests(reader: ServerCookieReader | null): void {
  serverCookieReaderForTests = reader;
}

/**
 * Fetches a short-lived HS256 token from the Next.js /api/token route for API POST calls.
 * Works from both server components (absolute URL with forwarded cookies) and client
 * components (relative URL that lets the browser include cookies).
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const isServer = typeof globalThis.window === "undefined";
    const base =
      isServer
        ? (process.env["NEXTAUTH_URL"] ?? "http://localhost:3000")
        : "";
    const cookieHeader = isServer ? await readServerCookieHeader() : null;
    const tokenRequestInit: RequestInit = { cache: "no-store" };
    if (cookieHeader) {
      tokenRequestInit.headers = { cookie: cookieHeader };
    }
    const res = await fetch(`${base}/api/token`, tokenRequestInit);
    if (!res.ok) return {};
    const { token } = (await res.json()) as { token: string };
    if (typeof token !== "string" || token.length === 0) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * Reads the current Next.js request cookie when API helpers run inside a server action.
 */
async function readServerCookieHeader(): Promise<string | null> {
  if (serverCookieReaderForTests) {
    return serverCookieReaderForTests();
  }

  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("cookie");
  } catch {
    return null;
  }
}

/**
 * Fetches and parses JSON from the API service.
 */
async function fetchApi<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(buildApiUrl(path), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw await buildApiError(response, "API request");
  }

  return (await response.json()) as TResponse;
}

/**
 * AuditEventQueryFilters narrows the admin and per-entity audit-log queries from
 * the web side. Every field maps to one URL search param consumed by the API's
 * `GET /audit-events` route.
 */
export interface AuditEventQueryFilters {
  actorId?: string | undefined;
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  outcome?: "succeeded" | "failed" | "denied" | undefined;
  occurredSince?: string | undefined;
  occurredUntil?: string | undefined;
}

/**
 * Fetches recent API action audit events for the admin workspace.
 * Optional filters narrow the result set; without filters the call returns the
 * global recent-events view used by the admin user-action timeline.
 */
export async function fetchAuditEvents(limit = 30, authHeaders?: Record<string, string>, filters: AuditEventQueryFilters = {}): Promise<AuditEventListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.targetType) params.set("targetType", filters.targetType);
  if (filters.targetId) params.set("targetId", filters.targetId);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.occurredSince) params.set("occurredSince", filters.occurredSince);
  if (filters.occurredUntil) params.set("occurredUntil", filters.occurredUntil);

  const response = await fetch(buildApiUrl(`/audit-events?${params.toString()}`), {
    cache: "no-store",
    headers: authHeaders ?? await getAuthHeaders()
  });

  if (!response.ok) {
    throw await buildApiError(response, "Audit events");
  }

  const envelope = (await response.json()) as ApiEnvelope<AuditEventListResponse>;
  return envelope.data;
}

/**
 * Fetches the most recent audit events for one entity so detail pages can render
 * a "Recent activity" strip. Returns null on any failure (unauthenticated, audit
 * store unavailable, transport error) so the calling page degrades gracefully.
 */
export async function fetchEntityAuditEvents(targetType: string, targetId: string, limit = 5, authHeaders?: Record<string, string>): Promise<AuditEventListResponse | null> {
  try {
    return await fetchAuditEvents(limit, authHeaders, { targetType, targetId });
  } catch {
    return null;
  }
}

/**
 * Builds a full API URL from a provider-neutral path.
 */
function buildApiUrl(path: string): string {
  return new URL(path, getApiBaseUrl()).toString();
}

/**
 * Builds an operational error message from the API error envelope when available.
 */
async function buildApiError(response: Response, action: string): Promise<Error> {
  const fallbackMessage = `${action} failed with HTTP ${response.status}`;

  try {
    const errorEnvelope = (await response.json()) as Partial<ApiErrorEnvelope> | { error?: unknown };
    const envelopeError = errorEnvelope.error;
    const errorCode = typeof envelopeError === "object" && envelopeError !== null && "code" in envelopeError && typeof envelopeError.code === "string" ? envelopeError.code : `HTTP_${response.status}`;
    const errorMessage = typeof envelopeError === "object" && envelopeError !== null && "message" in envelopeError && typeof envelopeError.message === "string" ? envelopeError.message : fallbackMessage;
    const errorDetails: Record<string, unknown> = {};
    if (typeof envelopeError === "object" && envelopeError !== null) {
      for (const [key, value] of Object.entries(envelopeError as Record<string, unknown>)) {
        if (key !== "code" && key !== "message") {
          errorDetails[key] = value;
        }
      }
    }

    return new ApiClientError(action, response.status, errorCode, errorMessage, errorDetails);
  } catch {
    return new ApiClientError(action, response.status, `HTTP_${response.status}`, fallbackMessage);
  }
}

/**
 * Fetches active and revoked substitution history for one catalog part.
 */
export async function fetchPartSubstitutions(partId: string): Promise<PartSubstitutionListResponse> {
  const envelope = await fetchApi<ApiEnvelope<PartSubstitutionListResponse>>(`/parts/${encodeURIComponent(partId)}/substitutions`);
  return envelope.data;
}

/**
 * Creates one approved substitution for a catalog part.
 */
export async function createPartSubstitution(
  partId: string,
  input: PartSubstitutionCreateInput
): Promise<PartSubstitutionCreateResponse> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/substitutions`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Part substitution create");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartSubstitutionCreateResponse>;
  return envelope.data;
}

/**
 * Revokes one previously-approved substitution while preserving audit history.
 */
export async function revokePartSubstitution(substitutionId: string): Promise<PartSubstitutionRevokeResponse> {
  const response = await fetch(buildApiUrl(`/substitutions/${encodeURIComponent(substitutionId)}/revoke`), {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Part substitution revoke");
  }

  const envelope = (await response.json()) as ApiEnvelope<PartSubstitutionRevokeResponse>;
  return envelope.data;
}

/**
 * Generates BOM lines for one circuit block instantiation against a project revision.
 */
export async function instantiateCircuitBlockIntoBom(
  projectId: string,
  input: CircuitBlockInstantiationCreateInput
): Promise<CircuitBlockInstantiationCreateResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/circuit-block-instantiations`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Circuit block instantiation");
  }

  const envelope = (await response.json()) as ApiEnvelope<CircuitBlockInstantiationCreateResponse>;

  return envelope.data;
}

/**
 * Creates a manifest-first export bundle for verified parts in a project.
 */
export async function createExportBundle(projectId: string, input: ExportBundleCreateInput): Promise<ExportBundleCreateResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/export-bundles`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Export bundle create");
  }

  const envelope = (await response.json()) as ApiEnvelope<ExportBundleCreateResponse>;

  return envelope.data;
}

/**
 * Fetches all export bundles for a project.
 */
export async function fetchProjectExportBundles(projectId: string): Promise<ExportBundleListResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/export-bundles`), { cache: "no-store" });

  if (!response.ok) {
    throw await buildApiError(response, "Export bundle list");
  }

  const envelope = (await response.json()) as ApiEnvelope<ExportBundleListResponse>;

  return envelope.data;
}

/**
 * Re-verifies one assembled bundle's archive hash and Ed25519 signature on demand. Returns the
 * structured outcome plus the freshly mapped bundle row (which carries the new
 * `signatureStatus` already persisted server-side).
 *
 * Honesty contract: a `verification_failed` outcome is the only honest answer when the recorded
 * hash no longer matches the bytes on disk. The UI must not silently fall back to `unsigned`.
 */
export async function verifyExportBundle(bundleId: string): Promise<ExportBundleVerifyResponse> {
  const response = await fetch(buildApiUrl(`/export-bundles/${encodeURIComponent(bundleId)}/verify`), {
    cache: "no-store",
    headers: await getAuthHeaders(),
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Export bundle verify");
  }

  const envelope = (await response.json()) as ApiEnvelope<ExportBundleVerifyResponse>;
  return envelope.data;
}

/**
 * Fetches match-status diagnostics for one BOM import.
 */
export async function fetchBomImportDiagnostics(importId: string): Promise<BomImportDiagnosticsResponse> {
  const response = await fetch(buildApiUrl(`/bom-imports/${encodeURIComponent(importId)}/diagnostics`), { cache: "no-store" });

  if (!response.ok) {
    throw await buildApiError(response, "BOM import diagnostics");
  }

  const envelope = (await response.json()) as ApiEnvelope<BomImportDiagnosticsResponse>;

  return envelope.data;
}

/**
 * Fetches a side-by-side comparison between two BOM imports.
 */
export async function fetchBomRevisionCompare(projectId: string, importId1: string, importId2: string): Promise<BomRevisionCompareResponse> {
  const params = new URLSearchParams({ importId1, importId2, projectId });
  const response = await fetch(buildApiUrl(`/bom-compare?${params.toString()}`), { cache: "no-store" });

  if (!response.ok) {
    throw await buildApiError(response, "BOM revision compare");
  }

  const envelope = (await response.json()) as ApiEnvelope<BomRevisionCompareResponse>;

  return envelope.data;
}

/**
 * Fetches a revision-vs-revision BOM diff for one project.
 */
export async function fetchProjectRevisionCompare(
  projectId: string,
  fromRevisionId: string,
  toRevisionId: string
): Promise<ProjectRevisionCompareResponse> {
  const params = new URLSearchParams({ from: fromRevisionId, to: toRevisionId });
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/revisions/compare?${params.toString()}`), { cache: "no-store" });

  if (!response.ok) {
    throw await buildApiError(response, "Project revision compare");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectRevisionCompareResponse>;

  return envelope.data;
}

/**
 * Fetches persisted BOM revision approval gates for one project.
 */
export async function fetchProjectRevisionApprovalGates(projectId: string): Promise<ProjectRevisionApprovalGateListResponse> {
  const envelope = await fetchApi<ApiEnvelope<ProjectRevisionApprovalGateListResponse>>(`/projects/${encodeURIComponent(projectId)}/revision-approval-gates`);
  return envelope.data;
}

/**
 * Records a BOM revision approval gate decision against the current computed diff.
 */
export async function upsertProjectRevisionApprovalGate(
  projectId: string,
  input: ProjectRevisionApprovalGateRequest
): Promise<ProjectRevisionApprovalGateResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/revision-approval-gates`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Project revision approval gate");
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectRevisionApprovalGateResponse>;
  return envelope.data;
}

/**
 * Fetches the connector-set catalog grouped by connector_class with mate context.
 */
export async function fetchConnectorSetCatalog(filters: { connectorClass?: ConnectorClass; query?: string } = {}): Promise<ConnectorSetListResponse> {
  const params = new URLSearchParams();
  if (filters.connectorClass) params.set("connectorClass", filters.connectorClass);
  if (filters.query && filters.query.trim().length > 0) params.set("q", filters.query.trim());
  const path = params.size > 0 ? `/connector-sets?${params.toString()}` : "/connector-sets";
  const envelope = await fetchApi<ApiEnvelope<ConnectorSetListResponse>>(path);
  return envelope.data;
}

/**
 * Resolves connector-set intent through the API without hiding incomplete buildability evidence.
 */
export async function resolveConnectorSetIntent(input: ConnectorSetIntentInput): Promise<ConnectorSetIntentResolution> {
  const response = await fetch(buildApiUrl("/connector-sets/resolve"), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Connector intent resolve");
  }

  const envelope = (await response.json()) as ApiEnvelope<ConnectorSetIntentResolution>;
  return envelope.data;
}

/**
 * Fetches the project-scoped approval candidate queue.
 */
export async function fetchApprovalBatchCandidates(projectId: string): Promise<ApprovalBatchCandidatesResponse> {
  const envelope = await fetchApi<ApiEnvelope<ApprovalBatchCandidatesResponse>>(`/projects/${encodeURIComponent(projectId)}/approval-candidates`);
  return envelope.data;
}

/**
 * Applies a bulk approval action triggered from a project BOM context.
 */
export async function applyApprovalBatch(projectId: string, input: ApprovalBatchRequest): Promise<ApprovalBatchResponse> {
  const response = await fetch(buildApiUrl(`/projects/${encodeURIComponent(projectId)}/approval-batch`), {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Approval batch");
  }

  const envelope = (await response.json()) as ApiEnvelope<ApprovalBatchResponse>;
  return envelope.data;
}

/**
 * Builds the API download URL for one asset so the UI can link directly to the redirect endpoint.
 */
export function buildAssetDownloadUrl(partId: string, assetId: string): string {
  return `${getApiBaseUrl()}/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(assetId)}/download`;
}

/**
 * Builds the URL for the derived preview artifact (e.g. glb/gltf converted from a STEP).
 * This is intentionally distinct from `buildAssetDownloadUrl`: the source asset bytes and
 * the derived viewer artifact have separate availability and trust contracts.
 */
export function buildAssetPreviewArtifactDownloadUrl(partId: string, assetId: string): string {
  return `${getApiBaseUrl()}/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(assetId)}/preview-artifact/download`;
}

const MAX_COMPARE_PARTS = 4;

/**
 * Builds the part-compare workspace URL with up to four distinct catalog part ids.
 */
export function buildCompareUrl(partIds: string[]): string {
  const unique = [...new Set(partIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_COMPARE_PARTS);

  if (unique.length === 0) {
    return "/compare";
  }

  return `/compare?parts=${unique.map(encodeURIComponent).join(",")}`;
}

/**
 * Builds the API URL that streams an export bundle file from local storage.
 * Returns null when the bundle is manifest-only (no captured storage key).
 */
export function buildExportBundleDownloadUrl(storageKey: string | null): string | null {
  if (!storageKey) return null;
  return `${getApiBaseUrl()}/storage/${encodeURIComponent(storageKey)}`;
}

/**
 * Resolves the API base URL for local and deployed web runtimes.
 *
 * In the browser this is always the same-origin /api-proxy path (rewritten to the API by
 * next.config.mjs), so an engineer's machine only ever needs to reach the web app address —
 * the API service can stay private to the server. Env URLs only apply server-side.
 */
export function getApiBaseUrl(): string {
  if (typeof globalThis.window !== "undefined") {
    return "/api-proxy";
  }

  return process.env.EE_LIBRARY_API_BASE_URL ?? "http://127.0.0.1:4000";
}

/**
 * Appends a query parameter only when it has a usable value.
 */
function appendSearchParam(searchParams: URLSearchParams, key: string, value: string | undefined): void {
  if (value && value.trim()) {
    searchParams.set(key, value);
  }
}
