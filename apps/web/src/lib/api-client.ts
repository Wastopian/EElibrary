/**
 * File header: Provides the web app's provider-neutral API access layer.
 */

import type { ApiEnvelope, PartDetailResponse, PartSearchFilters, PartSearchRecord, SearchFacets } from "@ee-library/shared/types";

/**
 * Fetches provider-neutral search facets from the API boundary.
 */
export async function fetchSearchFacets(): Promise<SearchFacets> {
  const envelope = await fetchApi<ApiEnvelope<SearchFacets>>("/parts/facets");

  return envelope.data;
}

/**
 * Fetches search results from the API boundary.
 */
export async function fetchPartSearch(filters: PartSearchFilters): Promise<PartSearchRecord[]> {
  const searchParams = new URLSearchParams();

  appendSearchParam(searchParams, "q", filters.query);
  appendSearchParam(searchParams, "manufacturerId", filters.manufacturerId);
  appendSearchParam(searchParams, "category", filters.category);
  appendSearchParam(searchParams, "packageId", filters.packageId);
  appendSearchParam(searchParams, "lifecycleStatus", filters.lifecycleStatus);
  appendSearchParam(searchParams, "cad", filters.cadAvailability === "any" ? undefined : filters.cadAvailability);

  const query = searchParams.toString();
  const envelope = await fetchApi<ApiEnvelope<PartSearchRecord[]>>(`/parts${query ? `?${query}` : ""}`);

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
    throw new Error(`API request failed with ${response.status}`);
  }

  const envelope = (await response.json()) as ApiEnvelope<PartDetailResponse>;

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
    throw new Error(`API request failed with ${response.status}`);
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
