/**
 * File header: Provides the web app's provider-neutral API access layer.
 */

import type { ApiEnvelope, PartSearchFilters, PartSearchRecord, SearchFacets, SystemHealthResponse } from "@ee-library/shared";

/** ImportExactMpnSuccess summarizes a successful direct import response from the API. */
export interface ImportExactMpnSuccess {
  status: "imported";
  partId: string;
  mpn: string;
  providerId: string;
  alreadyExisted: boolean;
}

/** ImportExactMpnFailure preserves provider-specific error reasons for the catalog UI. */
export interface ImportExactMpnFailure {
  status: "failed" | "rejected";
  reason: string;
  message: string;
  providerId?: string;
  mpn?: string;
  httpStatus: number;
}

export type ImportExactMpnResult = ImportExactMpnSuccess | ImportExactMpnFailure;

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
 * Fetches the system health payload used by the worker-status banner. Returns null on
 * transport failure so the search page can render an "API unreachable" state without crashing.
 */
export async function fetchSystemHealth(): Promise<SystemHealthResponse | null> {
  try {
    const response = await fetch(buildApiUrl("/system/health"), { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as SystemHealthResponse;
  } catch {
    return null;
  }
}

/**
 * Calls the direct-import endpoint with an exact MPN and returns a structured result.
 * Network failures map to a synthesized failure so the catalog UI can show clear copy.
 */
export async function importExactMpn(mpn: string, providerId?: string): Promise<ImportExactMpnResult> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl("/parts/import"), {
      body: JSON.stringify(providerId ? { mpn, providerId } : { mpn }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  } catch (error) {
    return {
      httpStatus: 0,
      message: error instanceof Error ? error.message : "Network error contacting the API",
      reason: "network_error",
      status: "failed"
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      httpStatus: response.status,
      message: `API returned non-JSON response (${response.status})`,
      reason: "invalid_response",
      status: "failed"
    };
  }

  if (response.ok && isImportSuccess(payload)) {
    return { ...payload, status: "imported" };
  }

  if (isImportFailure(payload)) {
    const failure: ImportExactMpnFailure = {
      httpStatus: response.status,
      message: payload.message,
      reason: payload.reason,
      status: payload.status === "rejected" ? "rejected" : "failed"
    };
    if (typeof payload.mpn === "string") {
      failure.mpn = payload.mpn;
    }
    if (typeof payload.providerId === "string") {
      failure.providerId = payload.providerId;
    }
    return failure;
  }

  return {
    httpStatus: response.status,
    message: `Unexpected import response shape (HTTP ${response.status})`,
    reason: "unexpected_response",
    status: "failed"
  };
}

/**
 * Type guard: import success payload from POST /parts/import.
 */
function isImportSuccess(value: unknown): value is { partId: string; mpn: string; providerId: string; alreadyExisted: boolean } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === "imported" &&
    typeof candidate.partId === "string" &&
    typeof candidate.mpn === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.alreadyExisted === "boolean"
  );
}

/**
 * Type guard: import failure or rejection payload from POST /parts/import.
 */
function isImportFailure(value: unknown): value is { status: "failed" | "rejected"; reason: string; message: string; mpn?: unknown; providerId?: unknown } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.status === "failed" || candidate.status === "rejected") &&
    typeof candidate.reason === "string" &&
    typeof candidate.message === "string"
  );
}

/**
 * Fetches one component detail record from the API boundary.
 */
export async function fetchPartDetail(partId: string): Promise<PartSearchRecord | null> {
  const response = await fetch(buildApiUrl(`/parts/${encodeURIComponent(partId)}`), {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  const envelope = (await response.json()) as ApiEnvelope<PartSearchRecord>;

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
