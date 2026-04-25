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

/** FETCH_CONCURRENCY is the number of category files fetched in parallel during full enumeration. */
const FETCH_CONCURRENCY = 6;

/** CATEGORY_HINT_PREFIX namespaces the category sourcename stored in acquisition job source_url. */
const CATEGORY_HINT_PREFIX = "jlcparts:category:";

/** INDEX_CACHE_TTL_MS keeps the index fresh without re-fetching it for every drain job. */
const INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

/** CATEGORY_CACHE_TTL_MS keeps recently accessed category files in memory across drain batches. */
const CATEGORY_CACHE_TTL_MS = 15 * 60 * 1000;

/** MAX_CACHED_CATEGORIES bounds peak memory use during a drain run (~5 MB per category file). */
const MAX_CACHED_CATEGORIES = 50;

/** cachedIndex stores the provider index between drain jobs so it is only fetched once per process. */
let cachedIndex: { index: JlcPartsIndex; cachedAt: number } | null = null;

/**
 * categoryFileCache keeps recently accessed compressed category payloads in memory.
 * Entries are evicted in insertion order (oldest first) once the map reaches MAX_CACHED_CATEGORIES.
 * During a drain run, jobs from the same category are consecutive in the queue so cache hit
 * rates are near 100% after the first job in each category.
 */
const categoryFileCache = new Map<string, { file: JlcPartsCategoryFile; cachedAt: number }>();

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

/**
 * Returns the total number of category entries in the provider index.
 * Useful for progress reporting before a full enumeration run.
 */
export async function countJlcCategories(): Promise<number> {
  const index = await fetchIndex();
  return flattenCategoryEntries(index).length;
}

/**
 * Yields one batch of ProviderPartRequest per category. Fetches FETCH_CONCURRENCY category
 * files in parallel to saturate the CDN connection without overwhelming it. Categories that
 * fail to load are skipped silently so a single bad payload does not abort the full run.
 */
export async function* enumerateJlcPartRequests(): AsyncGenerator<ProviderPartRequest[]> {
  const index = await fetchIndex();
  const entries = flattenCategoryEntries(index);

  for (let offset = 0; offset < entries.length; offset += FETCH_CONCURRENCY) {
    const batch = entries.slice(offset, offset + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((entry) => fetchCategoryPartRequests(entry)));

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.length > 0) {
        yield result.value;
      }
    }
  }
}

/**
 * Fetches and extracts all ProviderPartRequests from one category entry, embedding
 * the category sourcename as a hint so drain jobs can go directly to the right file.
 */
async function fetchCategoryPartRequests(entry: JlcPartsCategoryEntry): Promise<ProviderPartRequest[]> {
  const categoryFile = await fetchCategoryFile(entry.metadata.sourcename);
  return extractRequestsFromCategoryFile(categoryFile, entry.metadata.sourcename);
}

/**
 * Extracts ProviderPartRequests from a parsed category payload. The sourcename is embedded
 * in providerUrl as a namespaced hint so fetchJlcPartsRawPart can skip the full category
 * scan when processing the resulting acquisition jobs.
 */
function extractRequestsFromCategoryFile(categoryFile: JlcPartsCategoryFile, sourcename: string): ProviderPartRequest[] {
  const lcscIndex = categoryFile.schema.indexOf("lcsc");
  const mfrIndex = categoryFile.schema.indexOf("mfr");

  if (lcscIndex === -1 || mfrIndex === -1) {
    return [];
  }

  const hint = buildCategoryHint(sourcename);
  const requests: ProviderPartRequest[] = [];

  for (const row of categoryFile.components) {
    const lcsc = readNullableString(row[lcscIndex]);
    const mpn = readNullableString(row[mfrIndex]);

    if (lcsc) {
      requests.push({
        ...(mpn ? { mpn } : {}),
        providerPartId: lcsc,
        providerUrl: hint
      });
    }
  }

  return requests;
}

/**
 * Encodes a category sourcename as a namespaced hint string stored in providerUrl.
 */
function buildCategoryHint(sourcename: string): string {
  return `${CATEGORY_HINT_PREFIX}${sourcename}`;
}

/**
 * Decodes a category sourcename from providerUrl, or returns null when no hint is present.
 */
function extractCategoryHint(providerUrl: string | undefined): string | null {
  if (!providerUrl?.startsWith(CATEGORY_HINT_PREFIX)) {
    return null;
  }

  const sourcename = providerUrl.slice(CATEGORY_HINT_PREFIX.length);
  return sourcename.length > 0 ? sourcename : null;
}

/** jlcpartsProviderAdapter fetches and normalizes structured JLCPCB/LCSC metadata. */
export const jlcpartsProviderAdapter: ProviderAdapter = {
  async findExactPartCandidates(request) {
    try {
      const rawPayload = await fetchJlcPartsRawPart(
        {
          ...(request.manufacturerName ? { manufacturerName: request.manufacturerName } : {}),
          mpn: request.query,
          providerPartId: request.query
        },
        { allowEitherIdentifier: true }
      );
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
 *
 * Fast path: when request.providerUrl carries a jlcparts:category: hint (set during bulk
 * enqueue), the function goes directly to that category file and returns immediately on
 * a match — no full-catalog scan required. This reduces each drain job from potentially
 * hundreds of HTTP fetches to a single cache lookup (index warm) or two fetches (cold start).
 *
 * Fallback: if no hint is present, or the hinted category file does not contain the part
 * (e.g. the feed was updated and a part moved categories), the full priority-ordered scan
 * runs as before. The already-tried category is skipped to avoid a double fetch.
 */
async function fetchJlcPartsRawPart(
  request: ProviderPartRequest,
  options: { allowEitherIdentifier?: boolean } = {}
): Promise<RawProviderPayload> {
  const index = await fetchIndex();
  const identifiers = readRequestedIdentifiers(request);
  const categoryHint = extractCategoryHint(request.providerUrl);
  const allEntries = flattenCategoryEntries(index);

  if (categoryHint !== null) {
    const hintedEntry = allEntries.find((entry) => entry.metadata.sourcename === categoryHint);

    if (hintedEntry !== undefined) {
      const categoryFile = await fetchCategoryFile(categoryHint);
      const component = findMatchingComponent(categoryFile, identifiers, request.manufacturerName, options);

      if (component !== null) {
        return buildRawPayload(index, hintedEntry, component);
      }
    }
  }

  const categoryEntries = prioritizeCategoryEntries(allEntries, PRIORITY_CATEGORY_SOURCENAMES);

  for (const entry of categoryEntries) {
    if (categoryHint !== null && entry.metadata.sourcename === categoryHint) {
      continue;
    }

    const categoryFile = await fetchCategoryFile(entry.metadata.sourcename);
    const component = findMatchingComponent(categoryFile, identifiers, request.manufacturerName, options);

    if (component !== null) {
      return buildRawPayload(index, entry, component);
    }
  }

  throw new Error(`jlcparts metadata record not found for ${identifiers.providerPartId ?? identifiers.mpn ?? "unknown"}`);
}

/**
 * Assembles the canonical raw payload envelope from a matched index entry and component.
 */
function buildRawPayload(index: JlcPartsIndex, entry: JlcPartsCategoryEntry, component: JlcPartsComponent): RawProviderPayload {
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

/**
 * Returns whether a jlcparts lookup failure is just a clean no-match result.
 */
function isJlcPartsNotFoundError(error: unknown): boolean {
  return error instanceof Error && /metadata record not found/u.test(error.message);
}

/**
 * Finds the requested component by exact id before doing full row validation.
 */
function findMatchingComponent(
  categoryFile: JlcPartsCategoryFile,
  identifiers: { mpn: string | null; providerPartId: string | null },
  manufacturerName: string | undefined,
  options: { allowEitherIdentifier?: boolean }
): JlcPartsComponent | null {
  const lcscIndex = categoryFile.schema.indexOf("lcsc");
  const mfrIndex = categoryFile.schema.indexOf("mfr");

  if (lcscIndex === -1 || mfrIndex === -1) {
    throw new Error("Invalid jlcparts category schema: missing lcsc or mfr");
  }

  for (const row of categoryFile.components) {
    const candidateLcsc = readNullableString(row[lcscIndex])?.toLowerCase();
    const candidateMpn = readNullableString(row[mfrIndex])?.toLowerCase();
    const matchesProviderPartId = Boolean(identifiers.providerPartId && candidateLcsc === identifiers.providerPartId);
    const matchesMpn = Boolean(identifiers.mpn && candidateMpn === identifiers.mpn);
    const matchesIdentifier = options.allowEitherIdentifier
      ? matchesProviderPartId || matchesMpn
      : identifiers.providerPartId
        ? matchesProviderPartId
        : matchesMpn;

    if (!matchesIdentifier) {
      continue;
    }

    const component = mapComponentRow(categoryFile.schema, row);

    if (matchesPartRequest(component, identifiers, manufacturerName, options)) {
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
      description: component.description,
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
 * Fetches and validates the provider index JSON, using an in-process cache to avoid
 * re-fetching on every drain job. The cache is intentionally process-scoped: each worker
 * invocation gets a fresh start and the TTL prevents stale data on long-running drain runs.
 */
async function fetchIndex(): Promise<JlcPartsIndex> {
  if (cachedIndex !== null && Date.now() - cachedIndex.cachedAt < INDEX_CACHE_TTL_MS) {
    return cachedIndex.index;
  }

  const response = await fetch(INDEX_URL);

  if (!response.ok) {
    throw new Error(`Unable to fetch jlcparts index: ${response.status} ${response.statusText}`);
  }

  const index = (await response.json()) as JlcPartsIndex;
  cachedIndex = { cachedAt: Date.now(), index };
  return index;
}

/**
 * Fetches and decompresses one provider category payload, keeping it in-process for
 * CATEGORY_CACHE_TTL_MS. During a drain run, jobs from the same category arrive
 * consecutively (same requested_at in the queue) so this eliminates redundant downloads
 * and gunzip passes for the common case. Evicts the oldest entry when the cache is full.
 */
async function fetchCategoryFile(sourceName: string): Promise<JlcPartsCategoryFile> {
  const cached = categoryFileCache.get(sourceName);

  if (cached !== undefined && Date.now() - cached.cachedAt < CATEGORY_CACHE_TTL_MS) {
    return cached.file;
  }

  if (categoryFileCache.size >= MAX_CACHED_CATEGORIES) {
    const oldestKey = categoryFileCache.keys().next().value;
    if (oldestKey !== undefined) {
      categoryFileCache.delete(oldestKey);
    }
  }

  const response = await fetch(`${DATA_BASE_URL}/${sourceName}.json.gz`);

  if (!response.ok) {
    throw new Error(`Unable to fetch jlcparts category ${sourceName}: ${response.status} ${response.statusText}`);
  }

  const compressedBytes = Buffer.from(await response.arrayBuffer());
  const payload = JSON.parse(gunzipSync(compressedBytes).toString("utf8")) as JlcPartsCategoryFile;

  if (!Array.isArray(payload.schema) || !Array.isArray(payload.components)) {
    throw new Error(`Invalid jlcparts category payload: ${sourceName}`);
  }

  categoryFileCache.set(sourceName, { cachedAt: Date.now(), file: payload });
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
function matchesPartRequest(
  component: JlcPartsComponent,
  identifiers: { mpn: string | null; providerPartId: string | null },
  manufacturerName: string | undefined,
  options: { allowEitherIdentifier?: boolean }
): boolean {
  const manufacturer = readStringAttribute(component.attributes, "Manufacturer");
  const matchesProviderPartId = identifiers.providerPartId ? component.lcsc.toLowerCase() === identifiers.providerPartId : false;
  const matchesMpn = identifiers.mpn ? component.mfr.toLowerCase() === identifiers.mpn : false;
  const matchesIdentifier = options.allowEitherIdentifier
    ? matchesProviderPartId || matchesMpn
    : identifiers.providerPartId
      ? matchesProviderPartId
      : matchesMpn;
  const normalizedManufacturer = manufacturer ? normalizeManufacturerName(manufacturer) : null;
  const manufacturerSearchValues = normalizedManufacturer && manufacturer ? [manufacturer, normalizedManufacturer.canonicalName, ...normalizedManufacturer.aliases] : [];
  const normalizedRequestManufacturer = manufacturerName ? normalizeComparableText(manufacturerName) : null;
  const matchesManufacturer = !normalizedRequestManufacturer || manufacturerSearchValues.some((value) => normalizeComparableText(value).includes(normalizedRequestManufacturer));

  return matchesIdentifier && matchesManufacturer;
}

/**
 * Reads the exact request identifiers without forcing a provider catalog id through the MPN field.
 */
function readRequestedIdentifiers(request: ProviderPartRequest): { mpn: string | null; providerPartId: string | null } {
  const normalizedMpn = request.mpn?.trim().toLowerCase() ?? "";
  const normalizedProviderPartId = request.providerPartId?.trim().toLowerCase() ?? "";

  return {
    mpn: normalizedMpn.length > 0 ? normalizedMpn : null,
    providerPartId: normalizedProviderPartId.length > 0 ? normalizedProviderPartId : null
  };
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
