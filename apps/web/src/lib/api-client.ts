/**
 * File header: Provides the web app's provider-neutral API access layer.
 */

import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  AssetPromotionInput,
  AssetPromotionResponse,
  BomImportCreateInput,
  BomImportCreateResponse,
  BomImportPreviewInput,
  BomImportPreviewResponse,
  GenerationRequestCreateInput,
  GenerationRequestCreateResponse,
  GenerationTargetAssetType,
  PartDetailResponse,
  PartIssueCode,
  PartIssueWorkflowUpdateInput,
  PartIssueWorkflowUpdateResponse,
  ProjectDetailResponse,
  ProjectCreateInput,
  ProjectCreateResponse,
  ProjectListResponse,
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
  SearchFacets
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
  /** HTTP status returned by the API. */
  readonly statusCode: number;

  /**
   * Creates a typed API error with enough detail for setup and degraded-state rendering.
   */
  constructor(action: string, statusCode: number, code: string, message: string) {
    super(`${action} failed (${code}): ${message}`);
    this.name = "ApiClientError";
    this.action = action;
    this.code = code;
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
 * Fetches one component detail record from the API boundary.
 */
export async function fetchPartDetail(partId: string): Promise<PartDetailResponse | null> {
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

/**
 * Fetches a short-lived HS256 token from the Next.js /api/token route for API POST calls.
 * Works from both server components (absolute URL) and client components (relative URL).
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const base =
      typeof globalThis.window === "undefined"
        ? (process.env["NEXTAUTH_URL"] ?? "http://localhost:3000")
        : "";
    const res = await fetch(`${base}/api/token`, { cache: "no-store" });
    if (!res.ok) return {};
    const { token } = (await res.json()) as { token: string };
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
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

    return new ApiClientError(action, response.status, errorCode, errorMessage);
  } catch {
    return new ApiClientError(action, response.status, `HTTP_${response.status}`, fallbackMessage);
  }
}

/**
 * Builds the API download URL for one asset so the UI can link directly to the redirect endpoint.
 */
export function buildAssetDownloadUrl(partId: string, assetId: string): string {
  return `${getApiBaseUrl()}/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(assetId)}/download`;
}

/**
 * Resolves the API base URL for local and deployed web runtimes.
 */
function getApiBaseUrl(): string {
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
