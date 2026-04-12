/**
 * File header: Defines the worker-side provider adapter boundary without implementations.
 */

/** ProviderPartRequest describes the minimum lookup input for future provider fetches. */
export interface ProviderPartRequest {
  /** Manufacturer part number requested by the ingestion worker. */
  mpn: string;
  /** Optional manufacturer hint used only to narrow provider lookup. */
  manufacturerName?: string;
}

/** RawProviderPayload preserves raw source data before normalization. */
export interface RawProviderPayload {
  /** Opaque provider identifier used for provenance. */
  providerId: string;
  /** ISO timestamp for when the raw payload was fetched. */
  fetchedAt: string;
  /** Untrusted raw provider data that must pass through parsing before normalization. */
  payload: unknown;
}

/** ProviderAdapter defines the future provider boundary without binding a real provider. */
export interface ProviderAdapter {
  /** Stable adapter identifier. */
  id: string;
  /** Display-ready adapter name for logs and admin screens. */
  name: string;
  /** Fetches raw source payloads without normalizing in the fetch step. */
  fetchRawPart: (request: ProviderPartRequest) => Promise<RawProviderPayload>;
}

/** providerAdapters is intentionally empty until a real provider integration is added. */
export const providerAdapters: ProviderAdapter[] = [];
