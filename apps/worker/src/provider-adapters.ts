/**
 * File header: Defines the worker-side provider adapter boundary and registry.
 */

import type {
  AccessoryRequirement,
  Asset,
  AssetPromotionAuditRecord,
  AssetValidationRecord,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorFamily,
  ConnectorFamilyConflict,
  DatasheetRevision,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartMetric,
  PartSpecification,
  ProviderLookupCandidateBase,
  ReviewRecord,
  SimilarPartRelation,
  InventoryStatus,
  SourceExtractionSignal,
  SourceRecord
} from "@ee-library/shared/types";
import { digikeyProviderAdapter } from "./providers/digikey-provider";
import { jlcpartsProviderAdapter } from "./providers/jlcparts-provider";
import { kicadProviderAdapter } from "./providers/kicad-provider";
import { localCatalogProviderAdapter } from "./providers/local-catalog-provider";
import { mouserProviderAdapter } from "./providers/mouser-provider";
import { octopartProviderAdapter } from "./providers/octopart-provider";

/** ProviderPartRequest describes the minimum lookup input for future provider fetches. */
export interface ProviderPartRequest {
  /** Manufacturer part number requested by the ingestion worker when the import is MPN-driven. */
  mpn?: string;
  /** Provider-specific exact part identifier, such as an LCSC code, when intake selected a provider key. */
  providerPartId?: string;
  /** Optional manufacturer hint used only to narrow provider lookup. */
  manufacturerName?: string;
  /** Optional provider product URL retained as intake context or lookup source. */
  providerUrl?: string;
  /** Optional datasheet URL retained as intake context for later traceability. */
  datasheetUrl?: string;
}

/** ProviderExactLookupRequest describes one explicit exact-match provider candidate lookup. */
export interface ProviderExactLookupRequest {
  /** Exact lookup text entered by the caller. */
  query: string;
  /** Optional manufacturer hint used only for exact provider disambiguation. */
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

/** NormalizedSupplyPriceBreak is one persisted commercial price tier from a provider snapshot. */
export interface NormalizedSupplyPriceBreak {
  /** Stable deterministic tier id used for idempotent provider imports. */
  id: string;
  /** Parent supply offering id. */
  supplyOfferingId: string;
  /** Minimum order quantity for this unit price. */
  minQuantity: number;
  /** Provider-captured unit price without procurement approval semantics. */
  unitPrice: number;
  /** ISO 4217 currency code reported or conservatively defaulted by the provider adapter. */
  currencyCode: string;
  /** ISO timestamp for when this commercial snapshot was captured. */
  capturedAt: string;
}

/** NormalizedSupplyOffering stores provider commercial context before repository persistence. */
export interface NormalizedSupplyOffering {
  /** Stable deterministic offering id used for repeat imports. */
  id: string;
  /** Canonical part id receiving this commercial context. */
  partId: string;
  /** Provider adapter id that produced the snapshot. */
  providerId: string;
  /** Source record id preserving raw payload provenance for the snapshot. */
  sourceRecordId: string;
  /** Provider-specific part key, such as an LCSC code. */
  providerPartKey: string;
  /** Supplier or seller name when the provider exposes the commercial counterparty. */
  supplierName: string | null;
  /** Provider SKU when it differs from the provider part key. */
  providerSku: string | null;
  /** Availability snapshot status; it must not be treated as live stock truth. */
  inventoryStatus: InventoryStatus;
  /** Captured quantity when the provider exposes one. */
  inventoryQuantity: number | null;
  /** Minimum order quantity when exposed or inferable from price tiers. */
  moq: number | null;
  /** Lead time in days when the provider exposes one. */
  leadTimeDays: number | null;
  /** Provider packaging label, such as reel or cut tape. */
  packaging: string | null;
  /** Default currency for this offering and its tiers. */
  currencyCode: string;
  /** Provider-neutral rank used only for display ordering. */
  preferredRank: number | null;
  /** ISO timestamp for when the provider last exposed this offering. */
  lastSeenAt: string;
  /** ISO timestamp for first persistence of this deterministic offering id. */
  createdAt: string;
  /** ISO timestamp for the latest provider refresh of this offering. */
  updatedAt: string;
  /** Child price tiers captured with this offering snapshot. */
  priceBreaks: NormalizedSupplyPriceBreak[];
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
  /** Verbatim distributor specification rows kept for display; optional so CAD/fixture adapters can omit them. */
  specifications?: PartSpecification[];
  /** Supply offerings parsed from provider commercial snapshots. */
  supplyOfferings: NormalizedSupplyOffering[];
  /** Asset registry records parsed from the provider payload. */
  assets: Asset[];
  /** Best and alternate mate connector relationships parsed from the provider payload. */
  mateRelations: MateRelation[];
  /** Required, optional, and tooling accessory relationships parsed from the provider payload. */
  accessoryRequirements: AccessoryRequirement[];
  /** Compatible cable relationships parsed from the provider payload. */
  cableCompatibilities: CableCompatibility[];
  /** Connector-family ambiguity evidence parsed or derived for stronger connector warnings. */
  connectorFamilyConflicts: ConnectorFamilyConflict[];
  /** Similar-part recommendations parsed from the provider payload. */
  similarPartRelations: SimilarPartRelation[];
  /** Companion recommendations parsed from the provider payload. */
  companionRecommendations: CompanionRecommendation[];
  /** Datasheet-driven generation workflows parsed from the provider payload. */
  generationWorkflows: GenerationWorkflow[];
  /** Explicit review records parsed from the provider payload when local fixtures include them. */
  reviewRecords: ReviewRecord[];
  /** Explicit validation evidence parsed from fixtures or future validation jobs. */
  validationRecords: AssetValidationRecord[];
  /** Historical export-promotion audits parsed only when fixture data explicitly includes them. */
  promotionAudits: AssetPromotionAuditRecord[];
  /** Structured source extraction signals parsed or mapped for missing-CAD readiness. */
  extractionSignals: SourceExtractionSignal[];
}

/** ProviderAdapter defines the worker boundary for provider-specific ingestion logic. */
export interface ProviderAdapter {
  /** Stable adapter identifier. */
  id: string;
  /** Display-ready adapter name for logs and admin screens. */
  name: string;
  /** Finds exact-match provider candidates without persisting any catalog rows. */
  findExactPartCandidates: (request: ProviderExactLookupRequest) => Promise<ProviderLookupCandidateBase[]>;
  /** Lists supported local requests when the adapter can enumerate records. */
  listAvailablePartRequests: () => Promise<ProviderPartRequest[]>;
  /** Fetches raw source payloads without normalizing in the fetch step. */
  fetchRawPart: (request: ProviderPartRequest) => Promise<RawProviderPayload>;
  /** Normalizes a raw payload into provider-neutral records. */
  normalizeRawPart: (rawPayload: RawProviderPayload) => NormalizedProviderPart;
}

/**
 * providerAdapters registers worker-only provider implementations.
 *
 * Order is product policy: free providers (local catalog, JLC/LCSC, DigiKey,
 * Mouser, local KiCad index) come first so they are the default intake path.
 * The paid Octopart-via-Nexar aggregator is registered last and stays opt-in;
 * it only does anything when NEXAR_* credentials are configured.
 */
export const providerAdapters: ProviderAdapter[] = [
  localCatalogProviderAdapter,
  jlcpartsProviderAdapter,
  digikeyProviderAdapter,
  mouserProviderAdapter,
  kicadProviderAdapter,
  octopartProviderAdapter
];
