/**
 * File header: Provides seed-free catalog filtering, formatting, and export readiness helpers.
 */

import { isValidatedDownloadableAsset } from "./asset-state";
import type {
  Asset,
  AssetAvailabilityStatus,
  AssetExportStatus,
  AssetStatus,
  AssetType,
  CadAvailabilityFilter,
  ConnectorClass,
  ExportAvailability,
  LifecycleStatus,
  PartMetric,
  PartParameter,
  PartApprovalStatus,
  PartSearchFilters,
  PartReadinessStatus,
  PartSearchRecord,
  PartSearchSort,
  SearchPagination,
  SearchFacets
} from "./types";

/** CAD_ASSET_TYPES defines which asset classes count for CAD availability filters. */
const CAD_ASSET_TYPES = new Set<AssetType>(["footprint", "symbol", "three_d_model"]);

/** DEFAULT_SEARCH_PAGE_SIZE keeps first-page search responses compact and predictable. */
export const DEFAULT_SEARCH_PAGE_SIZE = 20;

/** MAX_SEARCH_PAGE_SIZE prevents accidental oversized search payloads. */
export const MAX_SEARCH_PAGE_SIZE = 100;

/**
 * Builds provider-neutral search facets from joined records.
 */
export function getSearchFacetsFromRecords(records: PartSearchRecord[]): SearchFacets {
  const manufacturerCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const packageCounts: Record<string, number> = {};
  const lifecycleCounts: Record<LifecycleStatus, number> = {
    active: 0,
    not_recommended: 0,
    obsolete: 0,
    unknown: 0
  };
  const readinessCounts: Record<PartReadinessStatus, number> = {
    blocked: 0,
    needs_attention: 0,
    ready_for_export_review: 0,
    unknown: 0
  };
  const approvalCounts: Record<PartApprovalStatus, number> = {
    approved: 0,
    not_applicable: 0,
    not_requested: 0,
    pending_review: 0
  };
  const connectorClassCounts: Record<ConnectorClass, number> = {
    accessory: 0,
    cable: 0,
    connector: 0,
    non_connector: 0,
    tooling: 0
  };
  let cadAvailableCount = 0;

  for (const record of records) {
    manufacturerCounts[record.manufacturer.id] = (manufacturerCounts[record.manufacturer.id] ?? 0) + 1;
    categoryCounts[record.part.category] = (categoryCounts[record.part.category] ?? 0) + 1;
    packageCounts[record.package.id] = (packageCounts[record.package.id] ?? 0) + 1;
    lifecycleCounts[record.part.lifecycleStatus] = (lifecycleCounts[record.part.lifecycleStatus] ?? 0) + 1;
    readinessCounts[record.readinessSummary.status] = (readinessCounts[record.readinessSummary.status] ?? 0) + 1;
    approvalCounts[record.approval.status] = (approvalCounts[record.approval.status] ?? 0) + 1;
    connectorClassCounts[record.readinessSummary.connectorClass] = (connectorClassCounts[record.readinessSummary.connectorClass] ?? 0) + 1;

    if (matchesCadAvailability(record.assets, "available")) {
      cadAvailableCount += 1;
    }
  }

  return {
    approvalStatuses: (["approved", "pending_review", "not_requested", "not_applicable"] as const).filter((status) => approvalCounts[status] > 0),
    categories: Array.from(new Set(records.map((record) => record.part.category))).sort(),
    connectorClasses: (["connector", "accessory", "tooling", "cable", "non_connector"] as const).filter((status) => connectorClassCounts[status] > 0),
    lifecycleStatuses: (["active", "not_recommended", "obsolete", "unknown"] as const).filter((status) => lifecycleCounts[status] > 0),
    // Seed records carry no reconciled parameters (those are DB-derived), so parametric filtering is a
    // DB-only capability; the empty list means the UI never renders parametric controls in seed mode.
    parameterFacets: [],
    manufacturers: uniqueBy(records.map((record) => record.manufacturer), (manufacturer) => manufacturer.id).sort((left, right) => left.name.localeCompare(right.name)),
    packages: uniqueBy(records.map((record) => record.package), (partPackage) => partPackage.id).sort((left, right) => left.packageName.localeCompare(right.packageName)),
    readinessStatuses: (["ready_for_export_review", "needs_attention", "blocked", "unknown"] as const).filter((status) => readinessCounts[status] > 0),
    counts: {
      approvalStatuses: approvalCounts,
      cadAvailability: {
        any: records.length,
        available: cadAvailableCount,
        unavailable: Math.max(0, records.length - cadAvailableCount)
      },
      categories: categoryCounts,
      connectorClasses: connectorClassCounts,
      lifecycleStatuses: lifecycleCounts,
      manufacturers: manufacturerCounts,
      packages: packageCounts,
      readinessStatuses: readinessCounts
    }
  };
}

/**
 * Filters joined part records with provider-neutral search filters.
 */
export function filterPartRecords(records: PartSearchRecord[], filters: PartSearchFilters = {}): PartSearchRecord[] {
  const normalizedQuery = filters.query?.trim().toLowerCase();
  const queryTokens = buildSearchQueryTokens(filters.query);

  return records.filter((record) => {
    const hasQueryMatch = normalizedQuery ? recordMatchesQuery(record, normalizedQuery, queryTokens) : true;
    const hasManufacturerMatch = filters.manufacturerId ? record.part.manufacturerId === filters.manufacturerId : true;
    const hasCategoryMatch = filters.category ? record.part.category === filters.category : true;
    const hasPackageMatch = filters.packageId ? record.part.packageId === filters.packageId : true;
    const hasLifecycleMatch = filters.lifecycleStatus ? record.part.lifecycleStatus === filters.lifecycleStatus : true;
    const hasCadMatch = matchesCadAvailability(record.assets, filters.cadAvailability ?? "any");
    const hasProviderPartIdMatch = filters.providerPartId ? record.sources.some((source) => source.providerPartKey.toLowerCase() === filters.providerPartId?.trim().toLowerCase()) : true;
    const hasProviderUrlMatch = filters.providerUrl ? record.sources.some((source) => (source.sourceUrl ?? "").toLowerCase().includes(filters.providerUrl?.trim().toLowerCase() ?? "")) : true;
    const hasDatasheetUrlMatch = filters.datasheetUrl
      ? record.assets.some((asset) => asset.assetType === "datasheet" && (asset.sourceUrl ?? "").toLowerCase().includes(filters.datasheetUrl?.trim().toLowerCase() ?? ""))
      : true;
    const hasReadinessStatusMatch = filters.readinessStatus ? record.readinessSummary.status === filters.readinessStatus : true;
    const hasApprovalStatusMatch = filters.approvalStatus ? record.approval.status === filters.approvalStatus : true;
    const hasConnectorClassMatch = filters.connectorClass ? record.readinessSummary.connectorClass === filters.connectorClass : true;
    // filters.parameters is intentionally not evaluated here: seed records carry no reconciled
    // parameters, so parametric filtering is DB-only (the UI hides the controls in seed mode).

    return (
      hasQueryMatch &&
      hasManufacturerMatch &&
      hasCategoryMatch &&
      hasPackageMatch &&
      hasLifecycleMatch &&
      hasCadMatch &&
      hasProviderPartIdMatch &&
      hasProviderUrlMatch &&
      hasDatasheetUrlMatch &&
      hasReadinessStatusMatch &&
      hasApprovalStatusMatch &&
      hasConnectorClassMatch
    );
  });
}

/**
 * Splits an engineer-entered catalog query into searchable alphanumeric fragments.
 * This lets `TPS7A02 DBVR` match `TPS7A02DBVR` and `JST PH 2P` match `JST-PH-2P-*`
 * without inventing provider-specific parsing rules.
 */
export function buildSearchQueryTokens(query: string | undefined): string[] {
  const normalizedQuery = normalizeSearchText(query ?? "");

  if (!normalizedQuery) {
    return [];
  }

  return [...new Set(normalizedQuery.split(" ").filter(Boolean))];
}

/**
 * Returns explicit engineering shorthand alternatives for one normalized search token.
 */
export function buildSearchTokenAlternates(token: string): string[] {
  const normalizedToken = normalizeSearchText(token);

  if (normalizedToken === "ldo") {
    return ["ldo", "linear regulator"];
  }

  return normalizedToken ? [normalizedToken] : [];
}

/**
 * Sorts joined records with the same stable modes used by SQL-backed search.
 */
export function sortPartRecords(records: PartSearchRecord[], sort: PartSearchSort = "mpn_asc"): PartSearchRecord[] {
  return [...records].sort((left, right) => {
    if (sort === "updated_desc") {
      return Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) || compareMpnAsc(left, right) || left.part.id.localeCompare(right.part.id);
    }

    if (sort === "trust_desc") {
      return right.part.trustScore - left.part.trustScore || compareMpnAsc(left, right) || left.part.id.localeCompare(right.part.id);
    }

    if (sort === "mpn_desc") {
      return right.part.mpn.localeCompare(left.part.mpn) || right.part.id.localeCompare(left.part.id);
    }

    return compareMpnAsc(left, right) || left.part.id.localeCompare(right.part.id);
  });
}

/**
 * Applies bounded pagination to already-filtered records for explicit local seed fallback.
 */
export function paginatePartRecords(records: PartSearchRecord[], filters: PartSearchFilters = {}): { pagination: SearchPagination; records: PartSearchRecord[] } {
  const pagination = buildSearchPagination(records.length, filters);
  const offset = (pagination.page - 1) * pagination.pageSize;

  return {
    pagination,
    records: records.slice(offset, offset + pagination.pageSize)
  };
}

/**
 * Builds normalized pagination metadata from total count and untrusted filter values.
 */
export function buildSearchPagination(totalRecords: number, filters: PartSearchFilters = {}): SearchPagination {
  const pageSize = clampInteger(filters.pageSize, DEFAULT_SEARCH_PAGE_SIZE, 1, MAX_SEARCH_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const page = Math.min(clampInteger(filters.page, 1, 1, Number.MAX_SAFE_INTEGER), totalPages);
  const sort = normalizeSearchSort(filters.sort);

  return {
    page,
    pageSize,
    sort,
    totalPages,
    totalRecords
  };
}

/**
 * Filters, sorts, and pages seed fallback records without importing seed data into runtime code.
 */
export function filterSortAndPaginatePartRecords(records: PartSearchRecord[], filters: PartSearchFilters = {}): { pagination: SearchPagination; records: PartSearchRecord[] } {
  return paginatePartRecords(sortPartRecords(filterPartRecords(records, filters), normalizeSearchSort(filters.sort)), filters);
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
 * Formats a canonical parameter key into a readable label.
 */
export function formatParameterLabel(paramKey: string): string {
  return formatMetricLabel(paramKey);
}

/**
 * Formats a canonical unit string for display, expanding non-obvious codes.
 */
export function formatParameterUnit(unit: string | null): string {
  if (unit === null) {
    return "";
  }

  if (unit === "ppm_per_c") {
    return "ppm/°C";
  }

  if (unit === "deg C") {
    return "°C";
  }

  return unit;
}

/**
 * Formats a normalized parameter value in its canonical unit for dense engineering tables.
 */
export function formatParameterValue(parameter: PartParameter): string {
  const unit = formatParameterUnit(parameter.unit);
  const suffix = unit.length > 0 ? ` ${unit}` : "";

  if (parameter.valueKind === "numeric" && parameter.valueNumeric !== null) {
    return `${formatMetricNumber(parameter.valueNumeric)}${suffix}`;
  }

  if (parameter.valueKind === "range" && parameter.valueMin !== null && parameter.valueMax !== null) {
    return `${formatMetricNumber(parameter.valueMin)} to ${formatMetricNumber(parameter.valueMax)}${suffix}`;
  }

  if (parameter.valueText !== null && parameter.valueText.length > 0) {
    return parameter.valueText;
  }

  return "Unknown";
}

/**
 * Formats canonical availability status without implying review or export readiness.
 */
export function formatAssetAvailabilityStatus(status: AssetAvailabilityStatus): string {
  const labels: Record<AssetAvailabilityStatus, string> = {
    downloaded: "Downloaded file",
    failed: "Failed asset",
    missing: "Missing asset",
    referenced: "Referenced only",
    validated: "Validated file"
  };

  return labels[status];
}

/**
 * Formats canonical export status without implying missing bundle pieces exist.
 */
export function formatAssetExportStatus(status: AssetExportStatus): string {
  const labels: Record<AssetExportStatus, string> = {
    not_exportable: "Not exportable",
    partially_exportable: "Partially exportable",
    verified_for_export: "Verified for export"
  };

  return labels[status];
}

/**
 * Formats legacy asset status without collapsing review state into file availability.
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
      reason: hasFootprint && hasSymbol ? "Stored, verified footprint and symbol are available." : "Requires stored footprint and symbol files verified for export."
    },
    {
      available: hasThreeDModel,
      id: "solidworks",
      label: "SolidWorks bundle",
      reason: hasThreeDModel ? "A stored, verified 3D model is available." : "Requires a stored 3D model file verified for export."
    },
    {
      available: hasStepModel,
      id: "neutral_cad",
      label: "Neutral CAD package",
      reason: hasStepModel ? "A stored, verified STEP model is available." : "Requires a stored STEP model file verified for export."
    }
  ];
}

/**
 * Checks whether a joined record matches free-text engineering search.
 */
function recordMatchesQuery(record: PartSearchRecord, normalizedQuery: string, queryTokens: string[]): boolean {
  const searchableValues = [
    record.part.mpn,
    record.part.category,
    record.part.description ?? "",
    record.manufacturer.name,
    record.package.packageName,
    record.connectorFamily?.name ?? "",
    ...record.sources.map((source) => source.providerPartKey),
    ...record.sources.map((source) => source.sourceUrl ?? ""),
    ...record.assets.filter((asset) => asset.assetType === "datasheet").map((asset) => asset.sourceUrl ?? ""),
    ...record.manufacturer.aliases
  ];
  const haystack = searchableValues.join(" ").toLowerCase();

  if (haystack.includes(normalizedQuery)) {
    return true;
  }

  const normalizedHaystack = expandSearchAliases(normalizeSearchText(searchableValues.join(" ")));
  const compactHaystack = compactSearchText(normalizedHaystack);

  return queryTokens.length > 0 && queryTokens.every((token) => {
    const tokenAlternates = buildSearchTokenAlternates(token);

    return tokenAlternates.some((candidate) => normalizedHaystack.includes(candidate) || compactHaystack.includes(compactSearchText(candidate)));
  });
}

/**
 * Converts punctuation, separators, and casing into a stable token-search string.
 */
function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

/**
 * Adds conservative engineering shorthand aliases to normalized searchable text.
 */
function expandSearchAliases(normalizedText: string): string {
  const aliases: string[] = [];

  if (/\bldo\b/u.test(normalizedText)) {
    aliases.push("linear regulator");
  }

  if (/\blinear regulator\b/u.test(normalizedText)) {
    aliases.push("ldo");
  }

  return aliases.length > 0 ? `${normalizedText} ${aliases.join(" ")}` : normalizedText;
}

/**
 * Removes token separators so package searches like `SOT23` can match `SOT-23-5`.
 */
function compactSearchText(value: string): string {
  return value.replace(/\s+/gu, "");
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
 * Compares MPNs case-insensitively while keeping the original string as a tie-break.
 */
function compareMpnAsc(left: PartSearchRecord, right: PartSearchRecord): number {
  return left.part.mpn.localeCompare(right.part.mpn, undefined, { sensitivity: "base" }) || left.part.mpn.localeCompare(right.part.mpn);
}

/**
 * Normalizes unknown sort values to the stable default.
 */
function normalizeSearchSort(sort: PartSearchSort | undefined): PartSearchSort {
  return sort === "mpn_desc" || sort === "updated_desc" || sort === "trust_desc" ? sort : "mpn_asc";
}

/**
 * Parses and clamps numeric pagination fields without trusting caller input.
 */
function clampInteger(value: number | undefined, defaultValue: number, minValue: number, maxValue: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return defaultValue;
  }

  return Math.min(Math.max(value, minValue), maxValue);
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
