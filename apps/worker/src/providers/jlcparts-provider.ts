/**
 * File header: Implements a worker-only JLCPCB/LCSC structured metadata adapter.
 */

import { gunzipSync } from "node:zlib";
import { deriveAssetState, withCanonicalAssetTruth } from "@ee-library/shared/asset-state";
import { normalizeLifecycleStatus } from "@ee-library/shared/normalization";
import type { Asset, DatasheetRevision, LifecycleStatus, MetricUnit, PartMetric, SourceExtractionSignal } from "@ee-library/shared/types";
import type { NormalizedProviderPart, ProviderAdapter, ProviderPartRequest, RawProviderPayload } from "../provider-adapters";
import { buildExactLookupCandidate } from "../provider-lookup-candidate";

/** JLC_PARTS_PROVIDER_ID is the canonical worker-only provider identifier. */
const JLC_PARTS_PROVIDER_ID = "jlcparts";

/** INDEX_URL points at the static structured jlcparts catalog index. */
const INDEX_URL = "https://yaqwsx.github.io/jlcparts/data/index.json";

/** DATA_BASE_URL points at compressed static category payloads. */
const DATA_BASE_URL = "https://yaqwsx.github.io/jlcparts/data";

/** PRODUCT_BASE_URL is used only for provenance links back to the provider record. */
const PRODUCT_BASE_URL = "https://lcsc.com/product-detail";

/** DEFAULT_IMPORT_REQUESTS keeps the no-argument provider ingest deterministic and real. */
const DEFAULT_IMPORT_REQUESTS: ProviderPartRequest[] = [
  {
    manufacturerName: "FH(Guangdong Fenghua Advanced Tech)",
    mpn: "RC-02W300JT"
  }
];

/** PRIORITY_CATEGORY_SOURCENAMES checks the known sample category before broad scanning. */
const PRIORITY_CATEGORY_SOURCENAMES = ["ResistorsChip_Resistor___Surface_Mount"];

/** JlcPartsIndex describes the public catalog index envelope. */
interface JlcPartsIndex {
  /** Source catalog generation timestamp from the jlcparts index. */
  created: string;
  /** Category and subcategory metadata keyed by display names. */
  categories: Record<string, Record<string, JlcPartsCategoryMetadata>>;
}

/** JlcPartsCategoryMetadata describes one compressed category payload. */
interface JlcPartsCategoryMetadata {
  /** Content hash exposed by the jlcparts feed. */
  datahash: string;
  /** Filename stem for the compressed category payload. */
  sourcename: string;
  /** Stock content hash exposed by the jlcparts feed. */
  stockhash: string;
}

/** JlcPartsCategoryEntry carries category context while searching the feed. */
interface JlcPartsCategoryEntry {
  /** Top-level category display name. */
  categoryName: string;
  /** Subcategory display name. */
  subcategoryName: string;
  /** Category metadata needed to fetch the compressed payload. */
  metadata: JlcPartsCategoryMetadata;
}

/** JlcPartsCategoryFile is the compressed category payload shape. */
interface JlcPartsCategoryFile {
  /** Column names for the component row arrays. */
  schema: string[];
  /** Component rows matching the schema order. */
  components: unknown[][];
}

/** JlcPartsAttribute describes one structured attribute from the provider feed. */
interface JlcPartsAttribute {
  /** Optional primary value key used by the feed UI. */
  primary?: string;
  /** Optional default value key used by some numeric attributes. */
  default?: string;
  /** Raw format string retained in source records. */
  format?: string;
  /** Raw value map where the tuple is value plus provider unit kind. */
  values: Record<string, [unknown, string]>;
}

/** JlcPartsComponent is the row shape after applying the category schema. */
interface JlcPartsComponent {
  /** LCSC catalog identifier, for example C1091. */
  lcsc: string;
  /** Manufacturer part number. */
  mfr: string;
  /** Number of solderable joints reported by the provider. */
  joints: number | null;
  /** Provider description text. */
  description: string;
  /** Datasheet URL when the provider exposes one. */
  datasheet: string | null;
  /** Price breaks retained only in the raw source record. */
  price: unknown;
  /** Provider image filename retained only in the raw source record. */
  img: string | null;
  /** Provider URL slug used to build the source URL. */
  url: string | null;
  /** Structured attributes used for normalization. */
  attributes: Record<string, JlcPartsAttribute>;
}

/** JlcPartsRawPayload preserves provider context for one matched component. */
interface JlcPartsRawPayload {
  /** Feed index creation timestamp. */
  indexCreatedAt: string;
  /** Top-level category display name. */
  categoryName: string;
  /** Subcategory display name. */
  subcategoryName: string;
  /** Source filename stem for the category payload. */
  categorySourceName: string;
  /** Matched provider component row. */
  component: JlcPartsComponent;
}

/** MetricCandidate carries one parsed provider metric before persistence IDs are assigned. */
interface MetricCandidate {
  /** Canonical metric key. */
  metricKey: string;
  /** Canonical unit. */
  unit: MetricUnit;
  /** Single numeric value when present. */
  metricValue: number | null;
  /** Minimum numeric value when the provider exposes a range. */
  minValue: number | null;
  /** Maximum numeric value when the provider exposes a range. */
  maxValue: number | null;
  /** Confidence score for the provider-normalized value. */
  confidenceScore: number;
}

/** NormalizedManufacturerName separates the canonical maker name from provider aliases. */
interface NormalizedManufacturerName {
  /** Canonical manufacturer display name persisted to the shared model. */
  canonicalName: string;
  /** Alias strings retained for search and provenance without leaking parser rules. */
  aliases: string[];
}

/** jlcpartsProviderAdapter fetches and normalizes structured JLCPCB/LCSC metadata. */
export const jlcpartsProviderAdapter: ProviderAdapter = {
  async findExactPartCandidates(request) {
    try {
      const rawPayload = await fetchJlcPartsRawPart({
        ...(request.manufacturerName ? { manufacturerName: request.manufacturerName } : {}),
        mpn: request.query
      });
      const normalizedPart = normalizeRawPart(rawPayload);

      return [buildExactLookupCandidate(normalizedPart, request.query)];
    } catch (error) {
      if (isJlcPartsNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  },
  async fetchRawPart(request) {
    return fetchJlcPartsRawPart(request);
  },
  id: JLC_PARTS_PROVIDER_ID,
  async listAvailablePartRequests() {
    return DEFAULT_IMPORT_REQUESTS;
  },
  name: "JLCPCB/LCSC structured catalog via jlcparts",
  normalizeRawPart
};

/**
 * Fetches one raw provider component by exact MPN or LCSC catalog id.
 */
async function fetchJlcPartsRawPart(request: ProviderPartRequest): Promise<RawProviderPayload> {
  const index = await fetchIndex();
  const categoryEntries = prioritizeCategoryEntries(flattenCategoryEntries(index), PRIORITY_CATEGORY_SOURCENAMES);
  const lookup = request.mpn.trim().toLowerCase();

  for (const entry of categoryEntries) {
    const categoryFile = await fetchCategoryFile(entry.metadata.sourcename);
    const component = findMatchingComponent(categoryFile, lookup, request.manufacturerName);

    if (component) {
      return {
        fetchedAt: new Date().toISOString(),
        payload: {
          categoryName: entry.categoryName,
          categorySourceName: entry.metadata.sourcename,
          component,
          indexCreatedAt: index.created,
          subcategoryName: entry.subcategoryName
        } satisfies JlcPartsRawPayload,
        providerId: JLC_PARTS_PROVIDER_ID
      };
    }
  }

  throw new Error(`jlcparts metadata record not found for ${request.mpn}`);
}

/**
 * Returns whether a jlcparts lookup failure is just a clean no-match result.
 */
function isJlcPartsNotFoundError(error: unknown): boolean {
  return error instanceof Error && /metadata record not found/u.test(error.message);
}

/**
 * Finds the requested component by exact id before doing full row validation.
 */
function findMatchingComponent(categoryFile: JlcPartsCategoryFile, lookup: string, manufacturerName: string | undefined): JlcPartsComponent | null {
  const lcscIndex = categoryFile.schema.indexOf("lcsc");
  const mfrIndex = categoryFile.schema.indexOf("mfr");

  if (lcscIndex === -1 || mfrIndex === -1) {
    throw new Error("Invalid jlcparts category schema: missing lcsc or mfr");
  }

  for (const row of categoryFile.components) {
    const candidateLcsc = readNullableString(row[lcscIndex])?.toLowerCase();
    const candidateMpn = readNullableString(row[mfrIndex])?.toLowerCase();

    if (candidateLcsc !== lookup && candidateMpn !== lookup) {
      continue;
    }

    const component = mapComponentRow(categoryFile.schema, row);

    if (matchesPartRequest(component, lookup, manufacturerName)) {
      return component;
    }
  }

  return null;
}

/**
 * Normalizes one raw jlcparts payload into provider-neutral canonical records.
 */
function normalizeRawPart(rawPayload: RawProviderPayload): NormalizedProviderPart {
  const payload = readJlcPartsRawPayload(rawPayload);
  const component = payload.component;
  const componentKey = slugify(component.lcsc);
  const partId = `part-jlcparts-${componentKey}`;
  const manufacturerName = normalizeManufacturerName(readStringAttribute(component.attributes, "Manufacturer") ?? "Unknown manufacturer");
  const packageName = normalizePackageName(readStringAttribute(component.attributes, "Package") ?? "Unknown package");
  const partCategory = normalizePartCategory(payload.categoryName, payload.subcategoryName);
  const manufacturerId = `mfr-jlcparts-${slugify(manufacturerName.canonicalName)}`;
  const packageId = `pkg-jlcparts-${slugify(packageName)}`;
  const sourceRecordId = `source-jlcparts-${componentKey}`;
  const datasheetRevisionId = `dsr-jlcparts-${componentKey}`;
  const datasheetAssetId = component.datasheet ? `asset-jlcparts-${componentKey}-datasheet` : null;
  const lastUpdatedAt = rawPayload.fetchedAt;

  return {
    accessoryRequirements: [],
    assets: buildAssets(component, partId, sourceRecordId, rawPayload.fetchedAt),
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    connectorFamilyConflicts: [],
    datasheetRevisions: [
      buildDatasheetRevision(component, partId, datasheetRevisionId, datasheetAssetId, sourceRecordId, lastUpdatedAt)
    ],
    extractionSignals: buildSourceExtractionSignals(component, partId, sourceRecordId, datasheetRevisionId, datasheetAssetId, lastUpdatedAt),
    generationWorkflows: [],
    manufacturer: {
      aliases: manufacturerName.aliases,
      id: manufacturerId,
      name: manufacturerName.canonicalName,
      website: null
    },
    mateRelations: [],
    metrics: buildMetrics(component, partId, datasheetRevisionId, sourceRecordId, lastUpdatedAt),
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: packageId,
      packageName,
      pinCount: parsePinCount(component.joints, packageName),
      pitchMm: null
    },
    part: {
      category: partCategory,
      connectorFamilyId: null,
      id: partId,
      lastUpdatedAt,
      lifecycleStatus: readLifecycleStatus(component),
      manufacturerId,
      mpn: component.mfr,
      packageId,
      trustScore: 0.62
    },
    promotionAudits: [],
    reviewRecords: [],
    similarPartRelations: [],
    validationRecords: [],
    sourceRecord: {
      fetchedAt: rawPayload.fetchedAt,
      id: sourceRecordId,
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt,
      normalizedAt: lastUpdatedAt,
      partId,
      providerId: JLC_PARTS_PROVIDER_ID,
      providerPartKey: component.lcsc,
      rawPayload: payload,
      sourceLastImportedAt: lastUpdatedAt,
      sourceLastSeenAt: rawPayload.fetchedAt,
      sourceUrl: buildProductUrl(component)
    }
  };
}

/**
 * Fetches and validates the provider index JSON.
 */
async function fetchIndex(): Promise<JlcPartsIndex> {
  const response = await fetch(INDEX_URL);

  if (!response.ok) {
    throw new Error(`Unable to fetch jlcparts index: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<JlcPartsIndex>;
}

/**
 * Fetches and decompresses one provider category payload.
 */
async function fetchCategoryFile(sourceName: string): Promise<JlcPartsCategoryFile> {
  const response = await fetch(`${DATA_BASE_URL}/${sourceName}.json.gz`);

  if (!response.ok) {
    throw new Error(`Unable to fetch jlcparts category ${sourceName}: ${response.status} ${response.statusText}`);
  }

  const compressedBytes = Buffer.from(await response.arrayBuffer());
  const payload = JSON.parse(gunzipSync(compressedBytes).toString("utf8")) as JlcPartsCategoryFile;

  if (!Array.isArray(payload.schema) || !Array.isArray(payload.components)) {
    throw new Error(`Invalid jlcparts category payload: ${sourceName}`);
  }

  return payload;
}

/**
 * Applies a provider category schema to a raw component row.
 */
function mapComponentRow(schema: string[], row: unknown[]): JlcPartsComponent {
  const mapped = new Map(schema.map((fieldName, index) => [fieldName, row[index]]));
  const component = {
    attributes: readAttributes(mapped.get("attributes")),
    datasheet: readNullableString(mapped.get("datasheet")),
    description: readRequiredString(mapped.get("description"), "description"),
    img: readNullableString(mapped.get("img")),
    joints: readNullableNumber(mapped.get("joints")),
    lcsc: readRequiredString(mapped.get("lcsc"), "lcsc"),
    mfr: readRequiredString(mapped.get("mfr"), "mfr"),
    price: mapped.get("price") ?? null,
    url: readNullableString(mapped.get("url"))
  };

  return component;
}

/**
 * Builds reference-only asset rows without inventing downloadable CAD.
 */
function buildAssets(component: JlcPartsComponent, partId: string, sourceRecordId: string, lastUpdatedAt: string): Asset[] {
  if (!component.datasheet) {
    return [];
  }

  const assetState = deriveAssetState({
    fileHash: null,
    sourceUrl: component.datasheet,
    storageKey: null,
    validationStatus: "not_validated"
  });

  return [
    withCanonicalAssetTruth({
      assetState,
      assetStatus: assetState,
      assetType: "datasheet",
      fileFormat: "pdf",
      fileHash: null,
      generationMethod: null,
      generationSourceAssetId: null,
      id: `asset-jlcparts-${slugify(component.lcsc)}-datasheet`,
      lastUpdatedAt,
      licenseMode: "metadata_only",
      partId,
      previewStatus: "not_available",
      providerId: JLC_PARTS_PROVIDER_ID,
      provenance: "trusted_external",
      sourceRecordId,
      sourceUrl: component.datasheet,
      storageKey: null,
      validationStatus: "not_validated"
    })
  ];
}

/**
 * Builds a datasheet revision placeholder that is honest about parse confidence.
 */
function buildDatasheetRevision(component: JlcPartsComponent, partId: string, datasheetRevisionId: string, datasheetAssetId: string | null, sourceRecordId: string, lastUpdatedAt: string): DatasheetRevision {
  return {
    fileAssetId: datasheetAssetId,
    id: datasheetRevisionId,
    lastUpdatedAt,
    pageCount: null,
    parseConfidence: 0,
    partId,
    pinTableStatus: "not_available",
    revisionDate: null,
    revisionLabel: component.datasheet ? "Provider datasheet reference" : "Provider metadata reference",
    sourceRecordId
  };
}

/**
 * Builds explicit extraction signals from structured provider metadata without claiming PDF parsing.
 */
function buildSourceExtractionSignals(component: JlcPartsComponent, partId: string, sourceRecordId: string, datasheetRevisionId: string, datasheetAssetId: string | null, lastUpdatedAt: string): SourceExtractionSignal[] {
  const componentKey = slugify(component.lcsc);
  const hasPackageCode = readStringAttribute(component.attributes, "Package") !== null;
  const hasPinCount = component.joints !== null && component.joints > 0;

  return [
    {
      assetId: datasheetAssetId,
      confidenceScore: hasPackageCode || hasPinCount ? 0.35 : 0,
      datasheetRevisionId,
      extractionSource: "provider_structured_metadata",
      extractionStatus: hasPackageCode || hasPinCount ? "needs_review" : "not_available",
      id: `sig-jlcparts-${componentKey}-package`,
      lastUpdatedAt,
      notes: hasPackageCode || hasPinCount ? "Provider package code or pin count was mapped; body and pitch dimensions were not extracted." : "No package/mechanical source signal was available in provider metadata.",
      partId,
      signalType: "package_mechanical_dimensions",
      sourceRecordId
    },
    {
      assetId: datasheetAssetId,
      confidenceScore: 0,
      datasheetRevisionId,
      extractionSource: "provider_structured_metadata",
      extractionStatus: "not_available",
      id: `sig-jlcparts-${componentKey}-pin-table`,
      lastUpdatedAt,
      notes: "No reviewed pin table was extracted from the structured provider metadata.",
      partId,
      signalType: "pin_table",
      sourceRecordId
    },
    {
      assetId: null,
      confidenceScore: 0,
      datasheetRevisionId,
      extractionSource: "provider_structured_metadata",
      extractionStatus: "not_available",
      id: `sig-jlcparts-${componentKey}-mechanical-drawing`,
      lastUpdatedAt,
      notes: "No mechanical drawing extraction signal was available in provider metadata.",
      partId,
      signalType: "mechanical_drawing",
      sourceRecordId
    }
  ];
}

/**
 * Builds normalized metrics from structured provider attributes only.
 */
function buildMetrics(component: JlcPartsComponent, partId: string, datasheetRevisionId: string, sourceRecordId: string, lastUpdatedAt: string): PartMetric[] {
  return readMetricCandidates(component.attributes).map((metric, index) => ({
    confidenceScore: metric.confidenceScore,
    id: `metric-jlcparts-${slugify(component.lcsc)}-${metric.metricKey}-${index + 1}`,
    lastUpdatedAt,
    maxValue: metric.maxValue,
    metricKey: metric.metricKey,
    metricValue: metric.metricValue,
    minValue: metric.minValue,
    partId,
    sourceRecordId,
    sourceRevisionId: datasheetRevisionId,
    unit: metric.unit
  }));
}

/**
 * Reads the subset of structured provider attributes supported in this first slice.
 */
function readMetricCandidates(attributes: Record<string, JlcPartsAttribute>): MetricCandidate[] {
  const candidates: MetricCandidate[] = [];
  const resistance = readPrimaryNumber(attributes, "Resistance");
  const capacitance = readPrimaryNumber(attributes, "Capacitance");
  const inductance = readPrimaryNumber(attributes, "Inductance");
  const overloadVoltage = readFirstNumber(readStringAttribute(attributes, "Overload voltage (max)") ?? readStringAttribute(attributes, "Voltage rating"));
  const temperatureRange = readTemperatureRange(readStringAttribute(attributes, "Operating temperature range"));

  if (resistance !== null) {
    candidates.push(buildSingleValueMetric("resistance", "ohm", resistance, 0.72));
  }

  if (capacitance !== null) {
    candidates.push(buildSingleValueMetric("capacitance", "F", capacitance, 0.72));
  }

  if (inductance !== null) {
    candidates.push(buildSingleValueMetric("inductance", "H", inductance, 0.72));
  }

  if (overloadVoltage !== null) {
    candidates.push(buildSingleValueMetric("overload_voltage_max", "V", overloadVoltage, 0.64));
  }

  if (temperatureRange) {
    candidates.push({
      confidenceScore: 0.64,
      maxValue: temperatureRange.maxValue,
      metricKey: "operating_temperature_range",
      metricValue: null,
      minValue: temperatureRange.minValue,
      unit: "deg C"
    });
  }

  return candidates;
}

/**
 * Builds one single-value metric candidate.
 */
function buildSingleValueMetric(metricKey: string, unit: MetricUnit, metricValue: number, confidenceScore: number): MetricCandidate {
  return {
    confidenceScore,
    maxValue: null,
    metricKey,
    metricValue,
    minValue: null,
    unit
  };
}

/**
 * Converts provider lifecycle attributes to the canonical lifecycle enum.
 */
function readLifecycleStatus(component: JlcPartsComponent): LifecycleStatus {
  return normalizeLifecycleStatus(readStringAttribute(component.attributes, "Status"));
}

/**
 * Returns true when a component exactly matches the requested MPN or LCSC id.
 */
function matchesPartRequest(component: JlcPartsComponent, lookup: string, manufacturerName: string | undefined): boolean {
  const manufacturer = readStringAttribute(component.attributes, "Manufacturer");
  const matchesIdentifier = component.mfr.toLowerCase() === lookup || component.lcsc.toLowerCase() === lookup;
  const normalizedManufacturer = manufacturer ? normalizeManufacturerName(manufacturer) : null;
  const manufacturerSearchValues = normalizedManufacturer && manufacturer ? [manufacturer, normalizedManufacturer.canonicalName, ...normalizedManufacturer.aliases] : [];
  const normalizedRequestManufacturer = manufacturerName ? normalizeComparableText(manufacturerName) : null;
  const matchesManufacturer = !normalizedRequestManufacturer || manufacturerSearchValues.some((value) => normalizeComparableText(value).includes(normalizedRequestManufacturer));

  return matchesIdentifier && matchesManufacturer;
}

/**
 * Flattens provider category metadata into deterministic search entries.
 */
function flattenCategoryEntries(index: JlcPartsIndex): JlcPartsCategoryEntry[] {
  return Object.entries(index.categories).flatMap(([categoryName, subcategories]) =>
    Object.entries(subcategories).map(([subcategoryName, metadata]) => ({
      categoryName,
      metadata,
      subcategoryName
    }))
  );
}

/**
 * Moves known category sourcenames to the front while preserving a complete fallback scan.
 */
function prioritizeCategoryEntries(entries: JlcPartsCategoryEntry[], prioritySourceNames: string[]): JlcPartsCategoryEntry[] {
  const priority = new Map(prioritySourceNames.map((sourceName, index) => [sourceName, index]));

  return [...entries].sort((first, second) => {
    const firstPriority = priority.get(first.metadata.sourcename) ?? Number.MAX_SAFE_INTEGER;
    const secondPriority = priority.get(second.metadata.sourcename) ?? Number.MAX_SAFE_INTEGER;

    return firstPriority - secondPriority || first.categoryName.localeCompare(second.categoryName) || first.subcategoryName.localeCompare(second.subcategoryName);
  });
}

/**
 * Reads and validates the raw provider payload type.
 */
function readJlcPartsRawPayload(rawPayload: RawProviderPayload): JlcPartsRawPayload {
  if (rawPayload.providerId !== JLC_PARTS_PROVIDER_ID) {
    throw new Error(`Unexpected jlcparts provider id: ${rawPayload.providerId}`);
  }

  const payload = rawPayload.payload as Partial<JlcPartsRawPayload>;

  if (!payload || typeof payload !== "object" || !payload.component || !payload.categoryName || !payload.subcategoryName || !payload.categorySourceName) {
    throw new Error("Invalid jlcparts raw payload");
  }

  return payload as JlcPartsRawPayload;
}

/**
 * Normalizes provider manufacturer aliases such as "FH(Guangdong Fenghua Advanced Tech)".
 */
function normalizeManufacturerName(rawName: string): NormalizedManufacturerName {
  const collapsedName = collapseWhitespace(rawName);
  const parentheticalAlias = /^([^()]+)\(([^()]+)\)$/u.exec(collapsedName);

  if (!parentheticalAlias) {
    return {
      aliases: [],
      canonicalName: collapsedName
    };
  }

  const shortName = parentheticalAlias[1]?.trim();
  const fullName = parentheticalAlias[2]?.trim();

  if (!shortName || !fullName) {
    return {
      aliases: [],
      canonicalName: collapsedName
    };
  }

  return {
    aliases: uniqueStrings([shortName, collapsedName]),
    canonicalName: fullName
  };
}

/**
 * Normalizes package labels while keeping provider-specific package parsing in the worker.
 */
function normalizePackageName(rawName: string): string {
  const collapsedName = collapseWhitespace(rawName);
  const chipPackage = /^(\d{4})(?:\s|\(|$)/u.exec(collapsedName);

  return chipPackage?.[1] ?? collapsedName.toUpperCase();
}

/**
 * Builds a stable category path from provider category and subcategory names.
 */
function normalizePartCategory(categoryName: string, subcategoryName: string): string {
  const category = collapseWhitespace(categoryName);
  const subcategory = collapseWhitespace(subcategoryName);

  return category === subcategory ? category : `${category} / ${subcategory}`;
}

/**
 * Collapses repeated whitespace in provider text values.
 */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ") || "Unknown";
}

/**
 * Normalizes strings used only for loose provider lookup comparison.
 */
function normalizeComparableText(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

/**
 * Returns strings once while preserving deterministic order.
 */
function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

/**
 * Reads a structured provider attribute string by display key.
 */
function readStringAttribute(attributes: Record<string, JlcPartsAttribute>, attributeName: string): string | null {
  const attribute = attributes[attributeName];
  const value = attribute ? readPrimaryAttributeValue(attribute) : null;

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Reads a structured provider attribute number by display key.
 */
function readPrimaryNumber(attributes: Record<string, JlcPartsAttribute>, attributeName: string): number | null {
  const attribute = attributes[attributeName];
  const value = attribute ? readPrimaryAttributeValue(attribute) : null;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads the primary or first provider attribute value.
 */
function readPrimaryAttributeValue(attribute: JlcPartsAttribute): unknown {
  const primaryKey = attribute.primary ?? attribute.default;
  const primaryValue = primaryKey ? attribute.values[primaryKey]?.[0] : undefined;

  if (primaryValue !== undefined) {
    return primaryValue;
  }

  return Object.values(attribute.values)[0]?.[0] ?? null;
}

/**
 * Reads an optional string from an untrusted row value.
 */
function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Reads a required string from an untrusted row value.
 */
function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid jlcparts field: ${fieldName}`);
  }

  return value;
}

/**
 * Reads an optional number from an untrusted row value.
 */
function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads the provider attributes map from an untrusted row value.
 */
function readAttributes(value: unknown): Record<string, JlcPartsAttribute> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, JlcPartsAttribute>;
}

/**
 * Parses the first decimal number from a provider text value.
 */
function readFirstNumber(value: string | null): number | null {
  const match = value?.match(/[+-]?\d+(?:\.\d+)?/u);

  return match?.[0] ? Number(match[0]) : null;
}

/**
 * Parses provider temperature range strings such as -55℃~+155℃.
 */
function readTemperatureRange(value: string | null): { minValue: number; maxValue: number } | null {
  const matches = value?.match(/[+-]?\d+(?:\.\d+)?/gu) ?? [];
  const minValue = matches[0] ? Number(matches[0]) : null;
  const maxValue = matches[1] ? Number(matches[1]) : null;

  return minValue !== null && maxValue !== null ? { maxValue, minValue } : null;
}

/**
 * Parses a package pin count from provider joints first, then package text.
 */
function parsePinCount(joints: number | null, packageName: string): number | null {
  if (joints !== null && joints > 0) {
    return joints;
  }

  const match = packageName.match(/(?:^|-)(\d{1,3})(?:$|[^\d])/u);

  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Builds a stable provider product URL from provider slug fields.
 */
function buildProductUrl(component: JlcPartsComponent): string | null {
  return component.url ? `${PRODUCT_BASE_URL}/${component.url}_${component.lcsc}.html` : null;
}

/**
 * Converts provider names and identifiers into deterministic lowercase ids.
 */
function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
}
