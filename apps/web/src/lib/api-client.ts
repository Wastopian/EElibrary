/**
 * File header: Provides the web app's provider-neutral API access layer.
 */

import type { ApiEnvelope, ApiErrorEnvelope, AssetPromotionInput, AssetPromotionResponse, GenerationRequestCreateInput, GenerationRequestCreateResponse, GenerationTargetAssetType, PartDetailResponse, PartSearchFilters, PartSearchRecord, ReviewActionInput, ReviewActionResponse, SearchFacets } from "@ee-library/shared/types";

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
export async function fetchSearchFacetsEnvelope(): Promise<ApiEnvelope<SearchFacets>> {
  return fetchApi<ApiEnvelope<SearchFacets>>("/parts/facets");
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
 * Creates a DB-backed generation request through the API without simulating completion.
 */
export async function createGenerationRequest(partId: string, targetAssetType: GenerationTargetAssetType): Promise<GenerationRequestCreateResponse> {
  const body: GenerationRequestCreateInput = { targetAssetType };
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}/generation-requests`), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
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
    headers: {
      "Content-Type": "application/json"
    },
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
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildApiError(response, "Asset promotion");
  }

  const envelope = (await response.json()) as ApiEnvelope<AssetPromotionResponse>;

  return envelope.data;
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
