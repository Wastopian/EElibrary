/**
 * File header: Implements a deterministic local catalog provider adapter for ingestion.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  deriveAssetState,
  normalizeAssetState,
  normalizeLifecycleStatus,
  normalizeMetricUnit,
  normalizeNullableNumber
} from "@ee-library/shared";
import type { Asset, DatasheetRevision, Manufacturer, Package, Part, PartMetric } from "@ee-library/shared";
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
  /** Raw canonical part payload without normalized foreign keys. */
  part: Omit<Part, "lastUpdatedAt" | "manufacturerId" | "packageId">;
  /** Raw datasheet payload without normalized part linkage. */
  datasheet: Omit<DatasheetRevision, "fileAssetId" | "lastUpdatedAt" | "partId" | "sourceRecordId">;
  /** Raw metric payloads using provider unit spellings. */
  metrics: LocalCatalogMetric[];
  /** Raw asset payloads without captured file evidence. */
  assets: LocalCatalogAsset[];
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
  /** Provider preview readiness value. */
  previewStatus: Asset["previewStatus"];
  /** Provider source URL when only a reference exists. */
  sourceUrl: string | null;
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
    assets: record.assets.map((asset) => normalizeAsset(asset, record, rawPayload, sourceRecordId)),
    datasheetRevisions: [
      {
        fileAssetId: datasheetAsset?.id ?? null,
        id: record.datasheet.id,
        lastUpdatedAt,
        pageCount: record.datasheet.pageCount,
        parseConfidence: record.datasheet.parseConfidence,
        partId: record.part.id,
        revisionDate: record.datasheet.revisionDate,
        revisionLabel: record.datasheet.revisionLabel,
        sourceRecordId
      }
    ],
    manufacturer: record.manufacturer,
    metrics: record.metrics.map((metric) => normalizeMetric(metric, record, rawPayload, sourceRecordId)),
    package: record.package,
    part: {
      category: record.part.category,
      id: record.part.id,
      lastUpdatedAt,
      lifecycleStatus: normalizeLifecycleStatus(record.part.lifecycleStatus),
      manufacturerId: record.manufacturer.id,
      mpn: record.part.mpn,
      packageId: record.package.id,
      trustScore: record.part.trustScore
    },
    sourceRecord: {
      fetchedAt: rawPayload.fetchedAt,
      id: sourceRecordId,
      lastUpdatedAt,
      normalizedAt: lastUpdatedAt,
      partId: record.part.id,
      providerId: rawPayload.providerId,
      providerPartKey: record.providerPartKey,
      rawPayload: rawPayload.payload,
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

  return {
    assetState: deriveAssetState({
      fileHash: null,
      sourceUrl: asset.sourceUrl,
      storageKey: null,
      validationStatus: normalizedState === "failed" ? "failed" : asset.validationStatus
    }),
    assetType: asset.assetType,
    fileFormat: asset.fileFormat,
    fileHash: null,
    id: asset.id,
    lastUpdatedAt: rawPayload.fetchedAt,
    licenseMode: asset.licenseMode,
    partId: record.part.id,
    previewStatus: asset.previewStatus,
    providerId: rawPayload.providerId,
    sourceRecordId,
    sourceUrl: asset.sourceUrl,
    storageKey: null,
    validationStatus: normalizedState === "failed" ? "failed" : asset.validationStatus
  };
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
