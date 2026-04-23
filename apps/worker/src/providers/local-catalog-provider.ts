/**
 * File header: Implements a deterministic local catalog provider adapter for ingestion.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveAssetState, withCanonicalAssetTruth } from "@ee-library/shared/asset-state";
import { normalizeAssetState, normalizeLifecycleStatus, normalizeMetricUnit, normalizeNullableNumber } from "@ee-library/shared/normalization";
import type { Asset, AssetPromotionAuditRecord, AssetValidationRecord, DatasheetRevision, Manufacturer, Package, Part, PartMetric } from "@ee-library/shared/types";
import type { AccessoryRequirement, CableCompatibility, CompanionRecommendation, ConnectorFamily, ConnectorFamilyConflict, GenerationWorkflow, MateRelation, ReviewRecord, SimilarPartRelation, SourceExtractionSignal } from "@ee-library/shared/types";
import type { NormalizedProviderPart, ProviderAdapter, ProviderPartRequest, RawProviderPayload } from "../provider-adapters";

/** LocalCatalogFile describes the adapter fixture envelope. */
interface LocalCatalogFile {
  /** Provider identifier used for every record in the file. */
  providerId: string;
  /** Provider source records available to ingest. */
  records: LocalCatalogRecord[];
}

/** LocalCatalogRecord describes one raw provider catalog record. */
interface LocalCatalogRecord {
  /** Provider-specific lookup key. */
  providerPartKey: string;
  /** Source URL for the provider record. */
  sourceUrl: string | null;
  /** Raw manufacturer payload. */
  manufacturer: Manufacturer;
  /** Raw package payload. */
  package: Package;
  /** Optional connector family payload for connector records. */
  connectorFamily?: ConnectorFamily | null;
  /** Raw canonical part payload without normalized foreign keys. */
  part: Omit<Part, "connectorFamilyId" | "lastUpdatedAt" | "manufacturerId" | "packageId"> & { connectorFamilyId?: string | null };
  /** Raw datasheet payload without normalized part linkage. */
  datasheet: Omit<DatasheetRevision, "fileAssetId" | "lastUpdatedAt" | "partId" | "sourceRecordId">;
  /** Raw metric payloads using provider unit spellings. */
  metrics: LocalCatalogMetric[];
  /** Raw asset payloads without captured file evidence. */
  assets: LocalCatalogAsset[];
  /** Optional raw connector mating relationships. */
  mateRelations?: MateRelation[];
  /** Optional raw connector accessory relationships. */
  accessoryRequirements?: AccessoryRequirement[];
  /** Optional raw connector cable compatibility relationships. */
  cableCompatibilities?: CableCompatibility[];
  /** Optional persisted connector-family ambiguity rows for stronger connector warnings. */
  connectorFamilyConflicts?: ConnectorFamilyConflict[];
  /** Optional raw similar-part relationships. */
  similarPartRelations?: SimilarPartRelation[];
  /** Optional raw companion recommendations. */
  companionRecommendations?: CompanionRecommendation[];
  /** Optional raw generation workflow records. */
  generationWorkflows?: GenerationWorkflow[];
  /** Optional raw review records for local review-state fixtures. */
  reviewRecords?: ReviewRecord[];
  /** Optional raw validation evidence for local trust-state fixtures. */
  validationRecords?: AssetValidationRecord[];
  /** Optional raw promotion audit history for local trust-state fixtures. */
  promotionAudits?: AssetPromotionAuditRecord[];
  /** Optional structured source extraction signals for local recovery fixtures. */
  extractionSignals?: SourceExtractionSignal[];
}

/** LocalCatalogMetric describes one raw metric from the provider file. */
interface LocalCatalogMetric {
  /** Stable metric identifier. */
  id: string;
  /** Provider metric key. */
  key: string;
  /** Provider numeric value when single-valued. */
  value?: number | string | null;
  /** Provider minimum value when ranged. */
  minValue?: number | string | null;
  /** Provider maximum value when ranged. */
  maxValue?: number | string | null;
  /** Provider unit spelling. */
  unit: string;
  /** Confidence score from parsing the source. */
  confidenceScore: number;
}

/** LocalCatalogAsset describes one raw asset reference from the provider file. */
interface LocalCatalogAsset {
  /** Stable asset identifier. */
  id: string;
  /** Provider-neutral asset type value. */
  assetType: Asset["assetType"];
  /** Provider-neutral file format value. */
  fileFormat: Asset["fileFormat"];
  /** Provider license mode value. */
  licenseMode: Asset["licenseMode"];
  /** Provider asset provenance value when the fixture knows it. */
  provenance?: Asset["provenance"];
  /** Provider asset review/export status when the fixture knows it. */
  assetStatus?: Asset["assetStatus"];
  /** Provider generation method when this is a generated asset. */
  generationMethod?: string | null;
  /** Source asset identifier when this asset was generated from another asset. */
  generationSourceAssetId?: string | null;
  /** Provider preview readiness value. */
  previewStatus: Asset["previewStatus"];
  /** Provider source URL when only a reference exists. */
  sourceUrl: string | null;
  /** Captured storage key when the provider fixture has a real stored file. */
  storageKey?: string | null;
  /** Captured file hash when the provider fixture has a real stored file. */
  fileHash?: string | null;
  /** Provider asset state spelling. */
  state: string;
  /** Provider validation status value. */
  validationStatus: Asset["validationStatus"];
}

/** DATA_PATH points to the deterministic local provider payload. */
const DATA_PATH = fileURLToPath(new URL("./local-catalog-data.json", import.meta.url));

/** localCatalogProviderAdapter reads and normalizes the local catalog provider payload. */
export const localCatalogProviderAdapter: ProviderAdapter = {
  async fetchRawPart(request) {
    const catalog = readCatalogFile();
    const record = catalog.records.find((candidate) => candidate.part.mpn.toLowerCase() === request.mpn.toLowerCase());

    if (!record) {
      throw new Error(`Local catalog part not found: ${request.mpn}`);
    }

    return {
      fetchedAt: new Date().toISOString(),
      payload: record,
      providerId: catalog.providerId
    };
  },
  id: "local-catalog",
  async listAvailablePartRequests() {
    const catalog = readCatalogFile();

    return catalog.records.map((record) => ({
      manufacturerName: record.manufacturer.name,
      mpn: record.part.mpn
    }));
  },
  name: "Local catalog fixture",
  normalizeRawPart
};

/**
 * Normalizes one raw local catalog payload into provider-neutral records.
 */
function normalizeRawPart(rawPayload: RawProviderPayload): NormalizedProviderPart {
  const record = readLocalCatalogRecord(rawPayload.payload);
  const lastUpdatedAt = rawPayload.fetchedAt;
  const sourceRecordId = `source-${rawPayload.providerId}-${record.providerPartKey.toLowerCase()}`;
  const datasheetAsset = record.assets.find((asset) => asset.assetType === "datasheet");

  return {
    accessoryRequirements: record.accessoryRequirements ?? [],
    assets: record.assets.map((asset) => normalizeAsset(asset, record, rawPayload, sourceRecordId)),
    cableCompatibilities: record.cableCompatibilities ?? [],
    companionRecommendations: record.companionRecommendations ?? [],
    connectorFamily: record.connectorFamily ?? null,
    connectorFamilyConflicts: record.connectorFamilyConflicts ?? [],
    datasheetRevisions: [
      {
        fileAssetId: datasheetAsset?.id ?? null,
        id: record.datasheet.id,
        lastUpdatedAt,
        pageCount: record.datasheet.pageCount,
        parseConfidence: record.datasheet.parseConfidence,
        pinTableStatus: record.datasheet.pinTableStatus,
        partId: record.part.id,
        revisionDate: record.datasheet.revisionDate,
        revisionLabel: record.datasheet.revisionLabel,
        sourceRecordId
      }
    ],
    generationWorkflows: record.generationWorkflows ?? [],
    extractionSignals: record.extractionSignals ?? [],
    manufacturer: record.manufacturer,
    mateRelations: record.mateRelations ?? [],
    metrics: record.metrics.map((metric) => normalizeMetric(metric, record, rawPayload, sourceRecordId)),
    package: record.package,
    part: {
      category: record.part.category,
      connectorFamilyId: record.part.connectorFamilyId ?? record.connectorFamily?.id ?? null,
      id: record.part.id,
      lastUpdatedAt,
      lifecycleStatus: normalizeLifecycleStatus(record.part.lifecycleStatus),
      manufacturerId: record.manufacturer.id,
      mpn: record.part.mpn,
      packageId: record.package.id,
      trustScore: record.part.trustScore
    },
    promotionAudits: record.promotionAudits ?? [],
    similarPartRelations: record.similarPartRelations ?? [],
    reviewRecords: record.reviewRecords ?? [],
    validationRecords: record.validationRecords ?? [],
    sourceRecord: {
      fetchedAt: rawPayload.fetchedAt,
      id: sourceRecordId,
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt,
      normalizedAt: lastUpdatedAt,
      partId: record.part.id,
      providerId: rawPayload.providerId,
      providerPartKey: record.providerPartKey,
      rawPayload: rawPayload.payload,
      sourceLastImportedAt: lastUpdatedAt,
      sourceLastSeenAt: rawPayload.fetchedAt,
      sourceUrl: record.sourceUrl
    }
  };
}

/**
 * Normalizes one provider metric into the shared metric type.
 */
function normalizeMetric(metric: LocalCatalogMetric, record: LocalCatalogRecord, rawPayload: RawProviderPayload, sourceRecordId: string): PartMetric {
  return {
    confidenceScore: metric.confidenceScore,
    id: metric.id,
    lastUpdatedAt: rawPayload.fetchedAt,
    maxValue: normalizeNullableNumber(metric.maxValue),
    metricKey: metric.key,
    metricValue: normalizeNullableNumber(metric.value),
    minValue: normalizeNullableNumber(metric.minValue),
    partId: record.part.id,
    sourceRecordId,
    sourceRevisionId: record.datasheet.id,
    unit: normalizeMetricUnit(metric.unit)
  };
}

/**
 * Normalizes one provider asset into the shared asset type without inventing file evidence.
 */
function normalizeAsset(asset: LocalCatalogAsset, record: LocalCatalogRecord, rawPayload: RawProviderPayload, sourceRecordId: string): Asset {
  const normalizedState = normalizeAssetState(asset.state);
  const assetState = deriveAssetState({
    fileHash: asset.fileHash ?? null,
    sourceUrl: asset.sourceUrl,
    storageKey: asset.storageKey ?? null,
    validationStatus: normalizedState === "failed" ? "failed" : asset.validationStatus
  });

  return withCanonicalAssetTruth({
    assetState,
    assetStatus: asset.assetStatus ?? assetState,
    assetType: asset.assetType,
    fileFormat: asset.fileFormat,
    fileHash: asset.fileHash ?? null,
    generationMethod: asset.generationMethod ?? null,
    generationSourceAssetId: asset.generationSourceAssetId ?? null,
    id: asset.id,
    lastUpdatedAt: rawPayload.fetchedAt,
    licenseMode: asset.licenseMode,
    partId: record.part.id,
    previewStatus: asset.previewStatus,
    providerId: rawPayload.providerId,
    provenance: asset.provenance ?? "manual_internal",
    sourceRecordId,
    sourceUrl: asset.sourceUrl,
    storageKey: asset.storageKey ?? null,
    validationStatus: normalizedState === "failed" ? "failed" : asset.validationStatus
  });
}

/**
 * Reads the local catalog fixture from disk.
 */
function readCatalogFile(): LocalCatalogFile {
  return JSON.parse(readFileSync(DATA_PATH, "utf8")) as LocalCatalogFile;
}

/**
 * Validates that the raw payload is shaped like a local catalog record.
 */
function readLocalCatalogRecord(payload: unknown): LocalCatalogRecord {
  if (!payload || typeof payload !== "object" || !("providerPartKey" in payload)) {
    throw new Error("Invalid local catalog payload");
  }

  return payload as LocalCatalogRecord;
}
