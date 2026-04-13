/**
 * File header: Provides seed-free catalog filtering, formatting, and export readiness helpers.
 */

import { isValidatedDownloadableAsset } from "./asset-state";
import type {
  Asset,
  AssetStatus,
  AssetType,
  CadAvailabilityFilter,
  ExportAvailability,
  PartMetric,
  PartSearchFilters,
  PartSearchRecord,
  SearchFacets
} from "./types";

/** CAD_ASSET_TYPES defines which asset classes count for CAD availability filters. */
const CAD_ASSET_TYPES = new Set<AssetType>(["footprint", "symbol", "three_d_model"]);

/**
 * Builds provider-neutral search facets from joined records.
 */
export function getSearchFacetsFromRecords(records: PartSearchRecord[]): SearchFacets {
  return {
    categories: Array.from(new Set(records.map((record) => record.part.category))).sort(),
    lifecycleStatuses: ["active", "not_recommended", "obsolete", "unknown"],
    manufacturers: uniqueBy(records.map((record) => record.manufacturer), (manufacturer) => manufacturer.id).sort((left, right) => left.name.localeCompare(right.name)),
    packages: uniqueBy(records.map((record) => record.package), (partPackage) => partPackage.id).sort((left, right) => left.packageName.localeCompare(right.packageName))
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
 * Formats a normalized metric value for dense engineering tables.
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
 * Formats asset status without collapsing review state into file availability.
 */
export function formatAssetStatus(assetStatus: AssetStatus): string {
  const labels: Record<AssetStatus, string> = {
    downloaded: "Downloaded",
    failed: "Failed",
    missing: "Missing",
    referenced: "Referenced metadata",
    reviewed: "Reviewed",
    validated: "Validated",
    verified_for_export: "Verified for export"
  };

  return labels[assetStatus];
}

/**
 * Counts verified file-backed CAD assets without implying that a full bundle is ready.
 */
export function getVerifiedCadAssetCount(record: PartSearchRecord): number {
  return record.assets.filter((asset) => CAD_ASSET_TYPES.has(asset.assetType) && isValidatedDownloadableAsset(asset)).length;
}

/**
 * Calculates export availability from true verified file-backed assets only.
 */
export function getExportAvailability(record: PartSearchRecord): ExportAvailability[] {
  const exportReadyAssets = record.assets.filter(isValidatedDownloadableAsset);
  const hasFootprint = exportReadyAssets.some((asset) => asset.assetType === "footprint");
  const hasSymbol = exportReadyAssets.some((asset) => asset.assetType === "symbol");
  const hasThreeDModel = exportReadyAssets.some((asset) => asset.assetType === "three_d_model");
  const hasStepModel = exportReadyAssets.some((asset) => asset.assetType === "three_d_model" && asset.fileFormat === "step");

  return [
    {
      available: hasFootprint && hasSymbol,
      id: "altium",
      label: "Altium bundle",
      reason: hasFootprint && hasSymbol ? "Verified file-backed footprint and symbol are available." : "Requires file-backed footprint and symbol assets verified for export."
    },
    {
      available: hasThreeDModel,
      id: "solidworks",
      label: "SolidWorks bundle",
      reason: hasThreeDModel ? "A verified file-backed 3D model is available." : "Requires a file-backed 3D model asset verified for export."
    },
    {
      available: hasStepModel,
      id: "neutral_cad",
      label: "Neutral CAD package",
      reason: hasStepModel ? "A verified file-backed STEP model is available." : "Requires a file-backed STEP model asset verified for export."
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
    record.connectorFamily?.name ?? "",
    ...record.manufacturer.aliases
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

/**
 * Checks whether CAD availability filters match strict export-ready CAD evidence.
 */
function matchesCadAvailability(assetsForPart: Asset[], availability: CadAvailabilityFilter): boolean {
  if (availability === "any") {
    return true;
  }

  const hasAvailableCadAsset = assetsForPart.some((asset) => CAD_ASSET_TYPES.has(asset.assetType) && isValidatedDownloadableAsset(asset));

  return availability === "available" ? hasAvailableCadAsset : !hasAvailableCadAsset;
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
