/**
 * File header: Shared provider-neutral normalization for free distributor and local CAD adapters.
 */

import { deriveAssetState, withCanonicalAssetTruth } from "@ee-library/shared/asset-state";
import type { Asset, AssetType, DatasheetRevision, FileFormat, InventoryStatus, LifecycleStatus, MetricUnit, PartMetric, SourceExtractionSignal } from "@ee-library/shared/types";
import type { NormalizedProviderPart, NormalizedSupplyOffering, NormalizedSupplyPriceBreak } from "../provider-adapters";

/** NeutralPriceBreak is one provider-agnostic price tier before persistence ids exist. */
export interface NeutralPriceBreak {
  /** Minimum order quantity for the unit price. */
  minQuantity: number;
  /** Unit price captured from the provider, never treated as procurement-approved. */
  unitPrice: number;
  /** ISO 4217 currency code for the tier. */
  currencyCode: string;
}

/** NeutralSupplyOffering is one provider-agnostic commercial snapshot before persistence ids exist. */
export interface NeutralSupplyOffering {
  /** Supplier or distributor display name. */
  supplierName: string;
  /** Distributor SKU when it differs from the manufacturer part number. */
  providerSku: string | null;
  /** Captured stock quantity snapshot, not a live-stock claim. */
  inventoryQuantity: number | null;
  /** On-order quantity snapshot when the provider exposes one. */
  onOrderQuantity?: number | null;
  /** Factory lead time in days when exposed. */
  leadTimeDays: number | null;
  /** Minimum order quantity when exposed. */
  moq: number | null;
  /** Provider packaging label such as reel or cut tape. */
  packaging: string | null;
  /** Display-only ordering rank. */
  preferredRank: number;
  /** Captured price tiers. */
  priceBreaks: NeutralPriceBreak[];
}

/** NeutralCadAsset is one local or external CAD reference for the KiCad index adapter. */
export interface NeutralCadAsset {
  /** Canonical engineering asset class. */
  assetType: AssetType;
  /** File format of the referenced CAD file. */
  fileFormat: FileFormat;
  /** Resolvable reference (local path or URL) preserved for provenance. */
  sourceUrl: string;
}

/** NeutralSpec is one structured provider attribute considered for metric extraction. */
export interface NeutralSpec {
  /** Normalized metric key. */
  metricKey: string;
  /** Canonical metric unit. */
  unit: MetricUnit;
  /** Raw provider display value. */
  rawValue: string | number | null;
}

/** AssembleNormalizedPartInput carries provider-neutral fields ready for canonical assembly. */
export interface AssembleNormalizedPartInput {
  /** Provider adapter id used for provenance and deterministic ids. */
  providerId: string;
  /** ISO timestamp for when the raw payload was fetched. */
  fetchedAt: string;
  /** Canonical manufacturer name. */
  manufacturerName: string;
  /** Manufacturer website when the provider exposes one. */
  manufacturerWebsite: string | null;
  /** Manufacturer part number. */
  mpn: string;
  /** Stable provider part key for source provenance. */
  providerPartKey: string;
  /** Best known package label. */
  packageName: string;
  /** Pin count when derivable. */
  pinCount: number | null;
  /** Category path text. */
  category: string;
  /** Engineer-readable description. */
  description: string;
  /** Lifecycle status mapped to the canonical enum. */
  lifecycleStatus: LifecycleStatus;
  /** Datasheet URL when the provider exposes one. */
  datasheetUrl: string | null;
  /** Structured metric candidates. */
  metrics: NeutralSpec[];
  /** Commercial snapshots. */
  supplyOfferings: NeutralSupplyOffering[];
  /** Provenance source URL. */
  sourceUrl: string;
  /** Conservative provider trust score. */
  trustScore: number;
  /** Raw payload preserved in the source record. */
  rawPayload: unknown;
  /** Optional local/external CAD references (used by the KiCad index adapter). */
  cadAssets?: NeutralCadAsset[];
}

/**
 * Assembles one provider-neutral normalized part with honest CAD, extraction, and supply truth.
 */
export function assembleNormalizedPart(input: AssembleNormalizedPartInput): NormalizedProviderPart {
  const providerSlug = slugify(input.providerId);
  const providerPartSlug = slugify(input.providerPartKey);
  const identitySlug = `${slugify(input.manufacturerName)}-${slugify(input.mpn)}`;
  const partId = `part-${providerSlug}-${identitySlug}`;
  const manufacturerId = `mfr-${providerSlug}-${slugify(input.manufacturerName)}`;
  const packageId = `pkg-${providerSlug}-${slugify(input.packageName)}`;
  const sourceRecordId = `source-${providerSlug}-${providerPartSlug}`;
  const datasheetRevisionId = `dsr-${providerSlug}-${providerPartSlug}`;
  const lastUpdatedAt = input.fetchedAt;
  const datasheetAsset = buildDatasheetAsset(input, partId, providerSlug, providerPartSlug, sourceRecordId, lastUpdatedAt);
  const cadAssets = buildCadAssets(input, partId, providerSlug, providerPartSlug, sourceRecordId, lastUpdatedAt);

  return {
    accessoryRequirements: [],
    assets: [...(datasheetAsset ? [datasheetAsset] : []), ...cadAssets],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    connectorFamilyConflicts: [],
    datasheetRevisions: [buildDatasheetRevision(input, partId, datasheetRevisionId, datasheetAsset?.id ?? null, sourceRecordId, lastUpdatedAt)],
    extractionSignals: buildSourceExtractionSignals(input, partId, sourceRecordId, datasheetRevisionId, datasheetAsset?.id ?? null, providerSlug, providerPartSlug, lastUpdatedAt),
    generationWorkflows: [],
    manufacturer: {
      aliases: [],
      id: manufacturerId,
      name: input.manufacturerName,
      website: input.manufacturerWebsite
    },
    mateRelations: [],
    metrics: buildMetrics(input, partId, datasheetRevisionId, sourceRecordId, providerSlug, providerPartSlug, lastUpdatedAt),
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: packageId,
      packageName: input.packageName,
      pinCount: input.pinCount,
      pitchMm: null
    },
    part: {
      category: input.category,
      connectorFamilyId: null,
      description: truncateDescription(input.description),
      id: partId,
      lastUpdatedAt,
      lifecycleStatus: input.lifecycleStatus,
      manufacturerId,
      mpn: input.mpn,
      packageId,
      trustScore: input.trustScore
    },
    promotionAudits: [],
    reviewRecords: [],
    similarPartRelations: [],
    supplyOfferings: buildSupplyOfferings(input, partId, sourceRecordId, providerSlug, providerPartSlug),
    validationRecords: [],
    sourceRecord: {
      fetchedAt: input.fetchedAt,
      id: sourceRecordId,
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt,
      normalizedAt: lastUpdatedAt,
      partId,
      providerId: input.providerId,
      providerPartKey: input.providerPartKey,
      rawPayload: input.rawPayload,
      sourceLastImportedAt: lastUpdatedAt,
      sourceLastSeenAt: input.fetchedAt,
      sourceUrl: input.sourceUrl
    }
  };
}

/**
 * Builds a datasheet reference asset without implying local storage.
 */
function buildDatasheetAsset(
  input: AssembleNormalizedPartInput,
  partId: string,
  providerSlug: string,
  providerPartSlug: string,
  sourceRecordId: string,
  lastUpdatedAt: string
): Asset | null {
  const datasheetUrl = normalizeOptionalText(input.datasheetUrl);

  if (!datasheetUrl) {
    return null;
  }

  const assetState = deriveAssetState({
    fileHash: null,
    sourceUrl: datasheetUrl,
    storageKey: null,
    validationStatus: "not_validated"
  });

  return withCanonicalAssetTruth({
    assetState,
    assetStatus: assetState,
    assetType: "datasheet",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: `asset-${providerSlug}-${providerPartSlug}-datasheet`,
    lastUpdatedAt,
    licenseMode: "metadata_only",
    partId,
    previewStatus: "not_available",
    providerId: input.providerId,
    provenance: "trusted_external",
    sourceRecordId,
    sourceUrl: datasheetUrl,
    storageKey: null,
    validationStatus: "not_validated"
  });
}

/**
 * Builds reference-only CAD assets for local index providers without claiming validation.
 */
function buildCadAssets(
  input: AssembleNormalizedPartInput,
  partId: string,
  providerSlug: string,
  providerPartSlug: string,
  sourceRecordId: string,
  lastUpdatedAt: string
): Asset[] {
  const cadAssets = input.cadAssets ?? [];

  return cadAssets.map((cad, index) => {
    const assetState = deriveAssetState({
      fileHash: null,
      sourceUrl: cad.sourceUrl,
      storageKey: null,
      validationStatus: "not_validated"
    });

    return withCanonicalAssetTruth({
      assetState,
      assetStatus: assetState,
      assetType: cad.assetType,
      fileFormat: cad.fileFormat,
      fileHash: null,
      generationMethod: null,
      generationSourceAssetId: null,
      id: `asset-${providerSlug}-${providerPartSlug}-${slugify(cad.assetType)}-${index + 1}`,
      lastUpdatedAt,
      licenseMode: "unknown",
      partId,
      previewStatus: "not_available",
      providerId: input.providerId,
      provenance: "trusted_external",
      sourceRecordId,
      sourceUrl: cad.sourceUrl,
      storageKey: null,
      validationStatus: "not_validated"
    });
  });
}

/**
 * Builds a datasheet revision placeholder that keeps parse confidence explicit.
 */
function buildDatasheetRevision(
  input: AssembleNormalizedPartInput,
  partId: string,
  datasheetRevisionId: string,
  datasheetAssetId: string | null,
  sourceRecordId: string,
  lastUpdatedAt: string
): DatasheetRevision {
  return {
    fileAssetId: datasheetAssetId,
    id: datasheetRevisionId,
    lastUpdatedAt,
    pageCount: null,
    parseConfidence: 0,
    partId,
    pinTableStatus: "not_available",
    revisionDate: null,
    revisionLabel: input.datasheetUrl ? "Provider datasheet reference" : "Provider metadata reference",
    sourceRecordId
  };
}

/**
 * Builds extraction signals from structured metadata without claiming reviewed CAD evidence.
 */
function buildSourceExtractionSignals(
  input: AssembleNormalizedPartInput,
  partId: string,
  sourceRecordId: string,
  datasheetRevisionId: string,
  datasheetAssetId: string | null,
  providerSlug: string,
  providerPartSlug: string,
  lastUpdatedAt: string
): SourceExtractionSignal[] {
  const hasPackageSignal = input.packageName !== "Unknown package" || input.pinCount !== null;

  return [
    {
      assetId: datasheetAssetId,
      confidenceScore: hasPackageSignal ? 0.35 : 0,
      datasheetRevisionId,
      extractionSource: "provider_structured_metadata",
      extractionStatus: hasPackageSignal ? "needs_review" : "not_available",
      id: `sig-${providerSlug}-${providerPartSlug}-package`,
      lastUpdatedAt,
      notes: hasPackageSignal
        ? "Provider package or pin-count metadata was mapped; body and pitch dimensions were not extracted."
        : "No package/mechanical source signal was available in provider metadata.",
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
      id: `sig-${providerSlug}-${providerPartSlug}-pin-table`,
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
      id: `sig-${providerSlug}-${providerPartSlug}-mechanical-drawing`,
      lastUpdatedAt,
      notes: "No mechanical drawing extraction signal was available in provider metadata.",
      partId,
      signalType: "mechanical_drawing",
      sourceRecordId
    }
  ];
}

/**
 * Builds normalized metric rows from structured specs that parse conservatively.
 */
function buildMetrics(
  input: AssembleNormalizedPartInput,
  partId: string,
  datasheetRevisionId: string,
  sourceRecordId: string,
  providerSlug: string,
  providerPartSlug: string,
  lastUpdatedAt: string
): PartMetric[] {
  return input.metrics
    .flatMap((spec) => {
      const metricValue = parseEngineeringNumber(spec.rawValue, spec.unit);

      return metricValue === null ? [] : [{ metricKey: spec.metricKey, metricValue, unit: spec.unit }];
    })
    .map((metric, index) => ({
      confidenceScore: 0.56,
      id: `metric-${providerSlug}-${providerPartSlug}-${metric.metricKey}-${index + 1}`,
      lastUpdatedAt,
      maxValue: null,
      metricKey: metric.metricKey,
      metricValue: metric.metricValue,
      minValue: null,
      partId,
      sourceRecordId,
      sourceRevisionId: datasheetRevisionId,
      unit: metric.unit
    }));
}

/**
 * Builds source-linked commercial snapshots without treating them as live stock truth.
 */
function buildSupplyOfferings(
  input: AssembleNormalizedPartInput,
  partId: string,
  sourceRecordId: string,
  providerSlug: string,
  providerPartSlug: string
): NormalizedSupplyOffering[] {
  const capturedAt = input.fetchedAt;

  return input.supplyOfferings.flatMap((offering, offeringIndex) => {
    const sellerSlug = slugify(offering.supplierName);
    const skuSlug = slugify(offering.providerSku ?? `${offeringIndex + 1}`);
    const offeringId = `supply-${providerSlug}-${providerPartSlug}-${sellerSlug}-${skuSlug}-${offeringIndex + 1}`;
    const priceBreaks = buildPriceBreaks(offering.priceBreaks, offeringId, providerSlug, providerPartSlug, sellerSlug, skuSlug, capturedAt);
    const onOrderQuantity = offering.onOrderQuantity ?? null;
    const moq = offering.moq ?? readMoqFromPriceBreaks(priceBreaks);

    if (priceBreaks.length === 0 && offering.inventoryQuantity === null && onOrderQuantity === null && offering.leadTimeDays === null && moq === null) {
      return [];
    }

    return [
      {
        createdAt: capturedAt,
        currencyCode: priceBreaks[0]?.currencyCode ?? "USD",
        id: offeringId,
        inventoryQuantity: offering.inventoryQuantity,
        inventoryStatus: readInventoryStatus(offering.inventoryQuantity, onOrderQuantity, offering.leadTimeDays),
        lastSeenAt: capturedAt,
        leadTimeDays: offering.leadTimeDays,
        moq,
        packaging: offering.packaging,
        partId,
        preferredRank: offering.preferredRank,
        priceBreaks,
        providerId: input.providerId,
        providerPartKey: input.providerPartKey,
        providerSku: offering.providerSku,
        supplierName: offering.supplierName,
        sourceRecordId,
        updatedAt: capturedAt
      }
    ];
  });
}

/**
 * Builds normalized price tier rows.
 */
function buildPriceBreaks(
  priceBreaks: NeutralPriceBreak[],
  offeringId: string,
  providerSlug: string,
  providerPartSlug: string,
  sellerSlug: string,
  skuSlug: string,
  capturedAt: string
): NormalizedSupplyPriceBreak[] {
  return priceBreaks.flatMap((tier, index) => {
    const minQuantity = readPositiveInteger(tier.minQuantity);
    const unitPrice = readNonNegativeNumber(tier.unitPrice);
    const currencyCode = readCurrencyCode(tier.currencyCode);

    if (minQuantity === null || unitPrice === null) {
      return [];
    }

    return [
      {
        capturedAt,
        currencyCode,
        id: `price-${providerSlug}-${providerPartSlug}-${sellerSlug}-${skuSlug}-${currencyCode.toLowerCase()}-${minQuantity}-${index + 1}`,
        minQuantity,
        supplyOfferingId: offeringId,
        unitPrice
      }
    ];
  });
}

/**
 * Reads the lowest positive price tier quantity as the inferred MOQ.
 */
function readMoqFromPriceBreaks(priceBreaks: NormalizedSupplyPriceBreak[]): number | null {
  return priceBreaks.reduce<number | null>((lowest, priceBreak) => {
    if (lowest === null || priceBreak.minQuantity < lowest) {
      return priceBreak.minQuantity;
    }

    return lowest;
  }, null);
}

/**
 * Maps provider inventory fields to the snapshot status enum without live-stock claims.
 */
function readInventoryStatus(inventoryQuantity: number | null, onOrderQuantity: number | null, leadTimeDays: number | null): InventoryStatus {
  if (inventoryQuantity !== null) {
    return inventoryQuantity > 0 ? "in_stock" : "out_of_stock";
  }

  if ((onOrderQuantity !== null && onOrderQuantity > 0) || leadTimeDays !== null) {
    return "backorder";
  }

  return "unknown";
}

/**
 * Parses common electronics unit strings into normalized base units.
 */
export function parseEngineeringNumber(value: unknown, unit: MetricUnit): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const match = text.match(/([+-]?\d+(?:\.\d+)?)/u);

  if (!match?.[1]) {
    return null;
  }

  const parsed = Number(match[1]);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed * readMetricMultiplier(text, unit);
}

/**
 * Reads unit prefixes from common provider display values.
 */
function readMetricMultiplier(text: string, unit: MetricUnit): number {
  const normalized = text.trim().toLowerCase();

  if (unit === "ohm") {
    if (/\b(mohm|m ohm|milliohm|milli-ohm)\b/iu.test(text)) return 0.001;
    if (/\b(kohm|k ohm|kiloohm)\b/u.test(normalized)) return 1_000;
    if (/\b(mohm|m ohm)\b/iu.test(text) || /\b(megohm|megaohm)\b/iu.test(text)) return 1_000_000;
  }

  if (unit === "F") {
    if (/\bpf\b/u.test(normalized)) return 1e-12;
    if (/\bnf\b/u.test(normalized)) return 1e-9;
    if (/\b(uf|microfarad)\b/u.test(normalized)) return 1e-6;
    if (/\b(mf|millifarad)\b/u.test(normalized)) return 1e-3;
  }

  if (unit === "H") {
    if (/\bnh\b/u.test(normalized)) return 1e-9;
    if (/\b(uh|microhenry)\b/u.test(normalized)) return 1e-6;
    if (/\b(mh|millihenry)\b/u.test(normalized)) return 1e-3;
  }

  if (unit === "V") {
    if (/\bmv\b/u.test(normalized)) return 1e-3;
    if (/\bkv\b/u.test(normalized)) return 1_000;
  }

  if (unit === "A") {
    if (/\bma\b/u.test(normalized)) return 1e-3;
    if (/\bua\b/u.test(normalized)) return 1e-6;
  }

  if (unit === "Hz") {
    if (/\bkhz\b/u.test(normalized)) return 1_000;
    if (/\bmhz\b/u.test(normalized)) return 1_000_000;
    if (/\bghz\b/u.test(normalized)) return 1_000_000_000;
  }

  return 1;
}

/** Maximum description length persisted to the parts table for keyword search. */
const MAX_NORMALIZED_DESCRIPTION_LENGTH = 200;

/**
 * Truncates long provider descriptions to the canonical parts table budget.
 */
export function truncateDescription(value: string): string {
  const collapsed = collapseWhitespace(value);

  if (collapsed.length <= MAX_NORMALIZED_DESCRIPTION_LENGTH) {
    return collapsed;
  }

  return collapsed.slice(0, MAX_NORMALIZED_DESCRIPTION_LENGTH).trimEnd();
}

/**
 * Collapses repeated provider whitespace into single spaces.
 */
export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/**
 * Reads optional provider text while trimming whitespace-only values to null.
 */
export function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? collapseWhitespace(value) : null;
}

/**
 * Reads a required provider text value.
 */
export function readRequiredText(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(`Invalid provider field: ${fieldName}`);
  }

  return normalized;
}

/**
 * Normalizes strings for exact-provider comparison only.
 */
export function normalizeComparableText(value: unknown): string {
  return typeof value === "string" ? collapseWhitespace(value).toLowerCase() : "";
}

/**
 * Reads a positive provider number from numeric or numeric-string values.
 */
export function readPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[, $]/gu, "")) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads a positive integer from provider numeric or numeric-string values.
 */
export function readPositiveInteger(value: unknown): number | null {
  const parsed = readPositiveNumber(value);

  return parsed !== null && parsed >= 1 ? Math.trunc(parsed) : null;
}

/**
 * Reads a nullable non-negative integer from provider numeric or numeric-string values.
 */
export function readNullableInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[, ]/gu, "")) : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

/**
 * Reads a non-negative finite number from provider numeric or numeric-string values.
 */
export function readNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[, $]/gu, "")) : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Reads an ISO 4217 currency code and defaults to USD when the provider omits it.
 */
export function readCurrencyCode(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim().toUpperCase() : "USD";

  return /^[A-Z]{3}$/u.test(candidate) ? candidate : "USD";
}

/**
 * Reads a pin count from common package text suffixes.
 */
export function readPinCountFromPackage(packageName: string): number | null {
  const match = packageName.match(/(?:^|[-\s])(\d{1,3})(?:$|[^\d])/u);

  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Converts provider names and identifiers into deterministic lowercase id fragments.
 */
export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
}
