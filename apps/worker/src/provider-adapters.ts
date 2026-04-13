/**
 * File header: Defines the worker-side provider adapter boundary and registry.
 */

import type {
  AccessoryRequirement,
  Asset,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorFamily,
  DatasheetRevision,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartMetric,
  SimilarPartRelation,
  SourceRecord
} from "@ee-library/shared/types";
import { localCatalogProviderAdapter } from "./providers/local-catalog-provider";

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

/** NormalizedProviderPart contains provider-neutral records ready for persistence. */
export interface NormalizedProviderPart {
  /** Canonical manufacturer record. */
  manufacturer: Manufacturer;
  /** Canonical package record. */
  package: Package;
  /** Optional connector family record for connector parts. */
  connectorFamily: ConnectorFamily | null;
  /** Canonical part record. */
  part: Part;
  /** Source record preserving the raw payload. */
  sourceRecord: SourceRecord;
  /** Datasheet revisions parsed from the provider payload. */
  datasheetRevisions: DatasheetRevision[];
  /** Normalized metrics parsed from the provider payload. */
  metrics: PartMetric[];
  /** Asset registry records parsed from the provider payload. */
  assets: Asset[];
  /** Best and alternate mate connector relationships parsed from the provider payload. */
  mateRelations: MateRelation[];
  /** Required, optional, and tooling accessory relationships parsed from the provider payload. */
  accessoryRequirements: AccessoryRequirement[];
  /** Compatible cable relationships parsed from the provider payload. */
  cableCompatibilities: CableCompatibility[];
  /** Similar-part recommendations parsed from the provider payload. */
  similarPartRelations: SimilarPartRelation[];
  /** Companion recommendations parsed from the provider payload. */
  companionRecommendations: CompanionRecommendation[];
  /** Datasheet-driven generation workflows parsed from the provider payload. */
  generationWorkflows: GenerationWorkflow[];
}

/** ProviderAdapter defines the worker boundary for provider-specific ingestion logic. */
export interface ProviderAdapter {
  /** Stable adapter identifier. */
  id: string;
  /** Display-ready adapter name for logs and admin screens. */
  name: string;
  /** Lists supported local requests when the adapter can enumerate records. */
  listAvailablePartRequests: () => Promise<ProviderPartRequest[]>;
  /** Fetches raw source payloads without normalizing in the fetch step. */
  fetchRawPart: (request: ProviderPartRequest) => Promise<RawProviderPayload>;
  /** Normalizes a raw payload into provider-neutral records. */
  normalizeRawPart: (rawPayload: RawProviderPayload) => NormalizedProviderPart;
}

/** providerAdapters registers worker-only provider implementations. */
export const providerAdapters: ProviderAdapter[] = [localCatalogProviderAdapter];
