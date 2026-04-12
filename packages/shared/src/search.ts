/**
 * File header: Provides provider-neutral search, lookup, formatting, and export helpers.
 */

import { assets, datasheetRevisions, manufacturers, partMetrics, partPackages, parts, sourceRecords } from "./seed";
import { isValidatedDownloadableAsset } from "./asset-state";
import type {
  Asset,
  AssetType,
  CadAvailabilityFilter,
  ExportAvailability,
  PartMetric,
  PartSearchFilters,
  PartSearchRecord,
  SearchFacets
} from "./types";

/** CAD asset types that can eventually participate in ECAD or MCAD export flows. */
const CAD_ASSET_TYPES = new Set<AssetType>(["footprint", "symbol", "three_d_model"]);

/** manufacturerById speeds up joins while keeping seed data normalized. */
const manufacturerById = new Map(manufacturers.map((manufacturer) => [manufacturer.id, manufacturer]));

/** packageById speeds up joins while keeping package data normalized. */
const packageById = new Map(partPackages.map((partPackage) => [partPackage.id, partPackage]));

/**
 * Builds a joined search record while skipping malformed seed rows.
 */
function buildPartSearchRecord(partId: string): PartSearchRecord | null {
  const part = parts.find((candidate) => candidate.id === partId);

  if (!part) {
    return null;
  }

  const manufacturer = manufacturerById.get(part.manufacturerId);
  const packageRecord = packageById.get(part.packageId);

  if (!manufacturer || !packageRecord) {
    return null;
  }

  const partAssets = assets.filter((asset) => asset.partId === part.id);
  const partDatasheetRevision = selectLatestDatasheetRevision(part.id);
  const metrics = partMetrics.filter((metric) => metric.partId === part.id);
  const sources = sourceRecords.filter((sourceRecord) => sourceRecord.partId === part.id);

  return {
    assets: partAssets,
    datasheetRevision: partDatasheetRevision,
    manufacturer,
    metrics,
    package: packageRecord,
    part,
    lastUpdatedAt: latestTimestamp([
      part.lastUpdatedAt,
      ...partAssets.map((asset) => asset.lastUpdatedAt),
      ...metrics.map((metric) => metric.lastUpdatedAt),
      ...(partDatasheetRevision ? [partDatasheetRevision.lastUpdatedAt] : []),
      ...sources.map((sourceRecord) => sourceRecord.lastUpdatedAt)
    ]),
    sources
  };
}

/**
 * Returns every joined seed record for web and API consumers.
 */
export function getAllPartRecords(): PartSearchRecord[] {
  return parts.flatMap((part) => {
    const record = buildPartSearchRecord(part.id);
    return record ? [record] : [];
  });
}

/**
 * Finds one joined part detail record by internal identifier.
 */
export function getPartDetail(partId: string): PartSearchRecord | undefined {
  return getAllPartRecords().find((record) => record.part.id === partId);
}

/**
 * Searches seed records with provider-neutral filters from the search page or API.
 */
export function searchParts(filters: PartSearchFilters = {}): PartSearchRecord[] {
  return filterPartRecords(getAllPartRecords(), filters);
}

/**
 * Builds the provider-neutral search facets exposed by the API.
 */
export function getSearchFacets(): SearchFacets {
  return getSearchFacetsFromRecords(getAllPartRecords());
}

/**
 * Builds provider-neutral search facets from joined records.
 */
export function getSearchFacetsFromRecords(records: PartSearchRecord[]): SearchFacets {
  return {
    categories: Array.from(new Set(records.map((record) => record.part.category))).sort(),
    lifecycleStatuses: ["active", "not_recommended", "obsolete", "unknown"],
    manufacturers: uniqueBy(records.map((record) => record.manufacturer), (manufacturer) => manufacturer.id),
    packages: uniqueBy(records.map((record) => record.package), (partPackage) => partPackage.id)
  };
}

/**
 * Filters joined part records with provider-neutral search filters.
 */
export function filterPartRecords(records: PartSearchRecord[], filters: PartSearchFilters = {}): PartSearchRecord[] {
  const normalizedQuery = filters.query?.trim().toLowerCase();

  return records.filter((record) => {
    const hasQueryMatch = normalizedQuery ? recordMatchesQuery(record, normalizedQuery) : true;
    const hasManufacturerMatch = filters.manufacturerId ? record.part.manufacturerId === filters.manufacturerId : true;
    const hasCategoryMatch = filters.category ? record.part.category === filters.category : true;
    const hasPackageMatch = filters.packageId ? record.part.packageId === filters.packageId : true;
    const hasLifecycleMatch = filters.lifecycleStatus ? record.part.lifecycleStatus === filters.lifecycleStatus : true;
    const hasCadMatch = matchesCadAvailability(record.assets, filters.cadAvailability ?? "any");

    return hasQueryMatch && hasManufacturerMatch && hasCategoryMatch && hasPackageMatch && hasLifecycleMatch && hasCadMatch;
  });
}

/**
 * Formats a metric key into a readable label while keeping the raw key available in code.
 */
export function formatMetricLabel(metricKey: string): string {
  return metricKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Formats normalized metric values without changing their underlying units.
 */
export function formatMetricValue(metric: PartMetric): string {
  if (metric.metricValue !== null) {
    return `${formatMetricNumber(metric.metricValue)} ${metric.unit}`;
  }

  if (metric.minValue !== null && metric.maxValue !== null) {
    return `${formatMetricNumber(metric.minValue)}-${formatMetricNumber(metric.maxValue)} ${metric.unit}`;
  }

  if (metric.minValue !== null) {
    return `>= ${formatMetricNumber(metric.minValue)} ${metric.unit}`;
  }

  if (metric.maxValue !== null) {
    return `<= ${formatMetricNumber(metric.maxValue)} ${metric.unit}`;
  }

  return `Unknown ${metric.unit}`;
}

/**
 * Calculates export availability from real validated downloadable assets only.
 */
export function getExportAvailability(record: PartSearchRecord): ExportAvailability[] {
  const exportableAssets = record.assets.filter(isValidatedDownloadableAsset);
  const hasFootprint = exportableAssets.some((asset) => asset.assetType === "footprint");
  const hasSymbol = exportableAssets.some((asset) => asset.assetType === "symbol");
  const hasThreeDModel = exportableAssets.some((asset) => asset.assetType === "three_d_model");
  const hasStepModel = exportableAssets.some((asset) => asset.assetType === "three_d_model" && asset.fileFormat === "step");

  return [
    {
      available: hasFootprint && hasSymbol,
      id: "altium",
      label: "Altium bundle",
      reason: hasFootprint && hasSymbol ? "Validated footprint and symbol files are available." : "Requires validated downloadable footprint and symbol assets."
    },
    {
      available: hasThreeDModel,
      id: "solidworks",
      label: "SolidWorks bundle",
      reason: hasThreeDModel ? "A validated downloadable 3D model is available." : "Requires a validated downloadable 3D model asset."
    },
    {
      available: hasStepModel,
      id: "neutral_cad",
      label: "Neutral CAD package",
      reason: hasStepModel ? "A validated downloadable STEP model is available." : "Requires a validated downloadable STEP model asset."
    }
  ];
}

/**
 * Checks whether a joined record matches free-text engineering search.
 */
function recordMatchesQuery(record: PartSearchRecord, normalizedQuery: string): boolean {
  const haystack = [
    record.part.mpn,
    record.part.category,
    record.manufacturer.name,
    record.package.packageName,
    ...record.manufacturer.aliases
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

/**
 * Selects the newest datasheet revision for a part using revision dates when available.
 */
function selectLatestDatasheetRevision(partId: string) {
  const revisions = datasheetRevisions.filter((revision) => revision.partId === partId);

  return (
    revisions.sort((first, second) => {
      const firstDate = first.revisionDate ? Date.parse(first.revisionDate) : 0;
      const secondDate = second.revisionDate ? Date.parse(second.revisionDate) : 0;

      return secondDate - firstDate;
    })[0] ?? null
  );
}

/**
 * Checks whether the asset list matches the requested CAD availability filter.
 */
function matchesCadAvailability(assetsForPart: Asset[], availability: CadAvailabilityFilter): boolean {
  if (availability === "any") {
    return true;
  }

  const hasAvailableCadAsset = assetsForPart.some((asset) => CAD_ASSET_TYPES.has(asset.assetType) && isValidatedDownloadableAsset(asset));

  return availability === "available" ? hasAvailableCadAsset : !hasAvailableCadAsset;
}

/**
 * Returns the newest ISO timestamp in a set of timestamp strings.
 */
function latestTimestamp(timestamps: string[]): string {
  return timestamps.sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? new Date(0).toISOString();
}

/**
 * Returns a deterministic list of records by identifier.
 */
function uniqueBy<TValue>(values: TValue[], getKey: (value: TValue) => string): TValue[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = getKey(value);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * Formats numbers compactly for dense engineering tables.
 */
function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toPrecision(4).replace(/\.?0+$/u, "");
}
