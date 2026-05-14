/**
 * File header: Implements a deterministic local catalog provider adapter for ingestion.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveAssetState, withCanonicalAssetTruth } from "@ee-library/shared/asset-state";
import { normalizeAssetState, normalizeLifecycleStatus, normalizeMetricUnit, normalizeNullableNumber } from "@ee-library/shared/normalization";
import type { Asset, AssetPromotionAuditRecord, AssetValidationRecord, DatasheetRevision, InventoryStatus, Manufacturer, Package, Part, PartMetric } from "@ee-library/shared/types";
import type { AccessoryRequirement, CableCompatibility, CompanionRecommendation, ConnectorFamily, ConnectorFamilyConflict, GenerationWorkflow, MateRelation, ReviewRecord, SimilarPartRelation, SourceExtractionSignal } from "@ee-library/shared/types";
import type { NormalizedProviderPart, NormalizedSupplyOffering, ProviderAdapter, ProviderPartRequest, RawProviderPayload } from "../provider-adapters";
import { buildExactLookupCandidate } from "../provider-lookup-candidate";

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
  /** Optional local commercial snapshots used to exercise supply-offer ingestion. */
  supplyOfferings?: LocalCatalogSupplyOffering[];
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

/** LocalCatalogPriceBreak describes one fixture price tier before deterministic ids are assigned. */
interface LocalCatalogPriceBreak {
  /** Minimum order quantity for the price tier. */
  minQuantity: number;
  /** Unit price captured by the fixture. */
  unitPrice: number;
  /** Optional ISO 4217 currency override for the tier. */
  currencyCode?: string;
}

/** LocalCatalogSupplyOffering describes one fixture commercial snapshot. */
interface LocalCatalogSupplyOffering {
  /** Supplier or seller name when the fixture intentionally models one. */
  supplierName?: string | null;
  /** Optional provider SKU when it differs from the part key. */
  providerSku?: string | null;
  /** Availability status captured by the fixture. */
  inventoryStatus?: InventoryStatus;
  /** Quantity captured by the fixture when known. */
  inventoryQuantity?: number | null;
  /** Minimum order quantity when known. */
  moq?: number | null;
  /** Lead time in days when known. */
  leadTimeDays?: number | null;
  /** Fixture packaging label, such as tape and reel. */
  packaging?: string | null;
  /** Default ISO 4217 currency for this offering. */
  currencyCode?: string;
  /** Display rank for deterministic UI ordering. */
  preferredRank?: number | null;
  /** Price tiers captured for the fixture offering. */
  priceBreaks?: LocalCatalogPriceBreak[];
}

/** DATA_PATH points to the deterministic local provider payload. */
const DATA_PATH = fileURLToPath(new URL("./local-catalog-data.json", import.meta.url));

/** localCatalogProviderAdapter reads and normalizes the local catalog provider payload. */
export const localCatalogProviderAdapter: ProviderAdapter = {
  async findExactPartCandidates(request) {
    try {
      const rawPayload = await fetchLocalCatalogRawPart(
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
      if (isLocalCatalogNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  },
  async fetchRawPart(request) {
    return fetchLocalCatalogRawPart(request);
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
 * Returns whether a local-catalog lookup failure is just a clean not-found outcome.
 */
function isLocalCatalogNotFoundError(error: unknown): boolean {
  return error instanceof Error && /^Local catalog part not found:/u.test(error.message);
}

/**
 * Fetches one deterministic local-catalog row by exact MPN or provider part key.
 */
async function fetchLocalCatalogRawPart(
  request: ProviderPartRequest,
  options: { allowEitherIdentifier?: boolean } = {}
): Promise<RawProviderPayload> {
  const catalog = readCatalogFile();
  const record = findLocalCatalogRecord(catalog.records, request, options);

  if (!record) {
    throw new Error(`Local catalog part not found: ${request.providerPartId ?? request.mpn ?? "unknown"}`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    payload: record,
    providerId: catalog.providerId
  };
}

/**
 * Finds one local-catalog record using exact import semantics or an explicit exact-lookup "either id type" mode.
 */
function findLocalCatalogRecord(
  records: LocalCatalogRecord[],
  request: ProviderPartRequest,
  options: { allowEitherIdentifier?: boolean }
): LocalCatalogRecord | undefined {
  const normalizedMpn = request.mpn?.trim().toLowerCase() ?? "";
  const normalizedProviderPartId = request.providerPartId?.trim().toLowerCase() ?? "";
  const normalizedManufacturerName = request.manufacturerName?.trim().toLowerCase() ?? "";

  return records.find((candidate) => {
    const matchesProviderPartId =
      normalizedProviderPartId.length > 0 &&
      candidate.providerPartKey.toLowerCase() === normalizedProviderPartId;
    const matchesMpn =
      normalizedMpn.length > 0 &&
      candidate.part.mpn.toLowerCase() === normalizedMpn;
    const matchesIdentifier = options.allowEitherIdentifier
      ? matchesProviderPartId || matchesMpn
      : normalizedProviderPartId.length > 0
        ? matchesProviderPartId
        : matchesMpn;
    const matchesManufacturer =
      normalizedManufacturerName.length === 0 ||
      candidate.manufacturer.name.toLowerCase().includes(normalizedManufacturerName);

    return matchesIdentifier && matchesManufacturer;
  });
}

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
      description: record.part.description,
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
    supplyOfferings: normalizeSupplyOfferings(record, rawPayload, sourceRecordId),
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
 * Normalizes local fixture commercial snapshots into provider-neutral supply offering rows.
 */
function normalizeSupplyOfferings(record: LocalCatalogRecord, rawPayload: RawProviderPayload, sourceRecordId: string): NormalizedSupplyOffering[] {
  const offerings = record.supplyOfferings ?? [];

  return offerings.map((offering, offeringIndex) => {
    const offeringId = `supply-${rawPayload.providerId}-${slugify(record.providerPartKey)}-${offeringIndex + 1}`;
    const currencyCode = normalizeCurrencyCode(offering.currencyCode);

    return {
      createdAt: rawPayload.fetchedAt,
      currencyCode,
      id: offeringId,
      inventoryQuantity: normalizeNullableInteger(offering.inventoryQuantity),
      inventoryStatus: offering.inventoryStatus ?? "unknown",
      lastSeenAt: rawPayload.fetchedAt,
      leadTimeDays: normalizeNullableInteger(offering.leadTimeDays),
      moq: normalizePositiveInteger(offering.moq),
      packaging: offering.packaging ?? null,
      partId: record.part.id,
      preferredRank: normalizePositiveInteger(offering.preferredRank) ?? offeringIndex + 1,
      priceBreaks: (offering.priceBreaks ?? []).flatMap((priceBreak, priceIndex) => {
        const minQuantity = normalizePositiveInteger(priceBreak.minQuantity);
        const unitPrice = normalizeNonNegativeNumber(priceBreak.unitPrice);

        if (minQuantity === null || unitPrice === null) {
          return [];
        }

        return [
          {
            capturedAt: rawPayload.fetchedAt,
            currencyCode: normalizeCurrencyCode(priceBreak.currencyCode ?? currencyCode),
            id: `price-${rawPayload.providerId}-${slugify(record.providerPartKey)}-${offeringIndex + 1}-${minQuantity}-${priceIndex + 1}`,
            minQuantity,
            supplyOfferingId: offeringId,
            unitPrice
          }
        ];
      }),
      providerId: rawPayload.providerId,
      providerPartKey: record.providerPartKey,
      providerSku: offering.providerSku ?? record.providerPartKey,
      supplierName: offering.supplierName ?? null,
      sourceRecordId,
      updatedAt: rawPayload.fetchedAt
    };
  });
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
  const catalog = JSON.parse(readFileSync(DATA_PATH, "utf8")) as LocalCatalogFile;

  return {
    ...catalog,
    records: [...catalog.records, ...buildConnectorIntelligenceSeedRecords()]
  };
}

/**
 * Builds deterministic connector-intelligence fixture rows so local worker ingest has useful resolver data on day one.
 */
function buildConnectorIntelligenceSeedRecords(): LocalCatalogRecord[] {
  const specs = [
    { family: "JST PH", manufacturer: "JST", pins: 2, pitchMm: 2.0, gaugeMin: 24, gaugeMax: 30, sealed: false },
    { family: "JST ZH", manufacturer: "JST", pins: 3, pitchMm: 1.5, gaugeMin: 26, gaugeMax: 32, sealed: false },
    { family: "JST SH", manufacturer: "JST", pins: 4, pitchMm: 1.0, gaugeMin: 28, gaugeMax: 32, sealed: false },
    { family: "Molex Pico-EZmate", manufacturer: "Molex", pins: 6, pitchMm: 1.2, gaugeMin: 28, gaugeMax: 32, sealed: false },
    { family: "Hirose DF13", manufacturer: "Hirose", pins: 10, pitchMm: 1.25, gaugeMin: 26, gaugeMax: 30, sealed: false },
    { family: "Phoenix MC", manufacturer: "Phoenix Contact", pins: 3, pitchMm: 3.5, gaugeMin: 16, gaugeMax: 28, sealed: false },
    { family: "TE AMPSEAL", manufacturer: "TE Connectivity", pins: 8, pitchMm: 4.0, gaugeMin: 14, gaugeMax: 20, sealed: true },
    { family: "Deutsch DT", manufacturer: "TE Connectivity", pins: 2, pitchMm: 4.5, gaugeMin: 14, gaugeMax: 20, sealed: true },
    { family: "Amphenol C091", manufacturer: "Amphenol", pins: 5, pitchMm: 1.5, gaugeMin: 20, gaugeMax: 28, sealed: true },
    { family: "JST PH sealed variant", manufacturer: "JST", pins: 4, pitchMm: 2.0, gaugeMin: 24, gaugeMax: 30, sealed: true }
  ];

  return specs.flatMap((spec, index) => buildConnectorSeedFamilyRecords(spec, index + 1));
}

/**
 * Builds one connector family with connector, mate, required accessory, tooling, and cable rows.
 */
function buildConnectorSeedFamilyRecords(
  spec: { family: string; gaugeMax: number; gaugeMin: number; manufacturer: string; pins: number; pitchMm: number; sealed: boolean },
  index: number
): LocalCatalogRecord[] {
  const slug = slugify(spec.family);
  const manufacturer = buildConnectorSeedManufacturer(spec.manufacturer);
  const connectorFamily: ConnectorFamily = {
    description: `${spec.family} ${spec.sealed ? "sealed " : ""}${spec.pins}-position connector system seeded for buildable-set resolver demos.`,
    id: `cf-ci-${slug}`,
    name: spec.family,
    series: spec.family
  };
  const packageRecord: Package = {
    bodyHeightMm: null,
    bodyLengthMm: null,
    bodyWidthMm: null,
    id: `pkg-ci-${slug}-${spec.pins}`,
    packageName: `${spec.family} ${spec.pins}-position`,
    pinCount: spec.pins,
    pitchMm: spec.pitchMm
  };
  const connectorId = `part-ci-${slug}-housing`;
  const mateId = `part-ci-${slug}-mate`;
  const terminalId = `part-ci-${slug}-terminal`;
  const toolingId = `part-ci-${slug}-tool`;
  const cableId = `part-ci-${slug}-cable`;
  const sealId = `part-ci-${slug}-seal`;
  const sourceRevisionId = `dsr-ci-${slug}`;
  const records = [
    buildConnectorSeedRecord({
      category: "Connector",
      connectorFamily,
      description: `${spec.family} ${spec.pins}-position ${spec.sealed ? "sealed " : ""}wire housing with deterministic mate, terminal, cable, and tooling rows.`,
      manufacturer,
      mpn: `${spec.family.replace(/\s+/gu, "-").toUpperCase()}-${spec.pins}P-HSG`,
      packageRecord,
      partId: connectorId,
      providerPartKey: `CI-${slug}-housing`,
      sourceRevisionId,
      trustScore: 0.86
    }),
    buildConnectorSeedRecord({
      category: "Connector",
      connectorFamily,
      description: `${spec.family} ${spec.pins}-position mating header or receptacle for the seeded housing.`,
      manufacturer,
      mpn: `${spec.family.replace(/\s+/gu, "-").toUpperCase()}-${spec.pins}P-MATE`,
      packageRecord,
      partId: mateId,
      providerPartKey: `CI-${slug}-mate`,
      sourceRevisionId,
      trustScore: 0.84
    }),
    buildConnectorSeedRecord({
      category: "Connector accessory",
      connectorFamily,
      description: `${spec.family} crimp terminal required for ${spec.gaugeMin}-${spec.gaugeMax} AWG conductors.`,
      manufacturer,
      mpn: `${spec.family.replace(/\s+/gu, "-").toUpperCase()}-TERM-${spec.gaugeMin}-${spec.gaugeMax}`,
      packageRecord,
      partId: terminalId,
      providerPartKey: `CI-${slug}-terminal`,
      sourceRevisionId,
      trustScore: 0.78
    }),
    buildConnectorSeedRecord({
      category: "Connector tooling",
      connectorFamily,
      description: `${spec.family} crimp applicator tooling for seeded terminals.`,
      manufacturer,
      mpn: `${spec.family.replace(/\s+/gu, "-").toUpperCase()}-CRIMP-TOOL`,
      packageRecord,
      partId: toolingId,
      providerPartKey: `CI-${slug}-tool`,
      sourceRevisionId,
      trustScore: 0.72
    }),
    buildConnectorSeedRecord({
      category: "Connector cable",
      connectorFamily,
      description: `${spec.family} compatible cable option for ${spec.gaugeMin}-${spec.gaugeMax} AWG conductors.`,
      manufacturer,
      mpn: `${spec.family.replace(/\s+/gu, "-").toUpperCase()}-CABLE-${spec.gaugeMin}-${spec.gaugeMax}`,
      packageRecord,
      partId: cableId,
      providerPartKey: `CI-${slug}-cable`,
      sourceRevisionId,
      trustScore: 0.74
    })
  ];

  if (spec.sealed) {
    records.push(buildConnectorSeedRecord({
      category: "Connector accessory",
      connectorFamily,
      description: `${spec.family} seal plug and backshell accessory for sealed harness builds.`,
      manufacturer,
      mpn: `${spec.family.replace(/\s+/gu, "-").toUpperCase()}-SEAL-KIT`,
      packageRecord,
      partId: sealId,
      providerPartKey: `CI-${slug}-seal`,
      sourceRevisionId,
      trustScore: 0.76
    }));
  }

  records[0] = {
    ...records[0]!,
    accessoryRequirements: [
      buildAccessoryRequirement(`acc-ci-${slug}-terminal`, connectorId, terminalId, "requires_accessory", sourceRevisionId, "Required crimp terminal for a buildable harness."),
      buildAccessoryRequirement(`acc-ci-${slug}-tool`, connectorId, toolingId, "tooling_requirement", sourceRevisionId, "Recommended crimp tooling for repeatable production builds."),
      ...(spec.sealed ? [buildAccessoryRequirement(`acc-ci-${slug}-seal`, connectorId, sealId, "optional_accessory", sourceRevisionId, "Seal kit required when the design intent calls for sealed/IP-rated service.")] : [])
    ],
    cableCompatibilities: [
      {
        cablePartId: cableId,
        compatibilityStatus: "probable",
        confidenceScore: 0.82,
        id: `cable-ci-${slug}`,
        notes: `${spec.gaugeMin}-${spec.gaugeMax} AWG ${spec.sealed ? "sealed harness" : "internal harness"} assumption from deterministic local fixture.`,
        partId: connectorId,
        relationshipType: "supports_cable",
        shieldingRequirement: "either",
        sourceRecordId: null,
        sourceRevisionId,
        terminationStyle: "crimp",
        wireGaugeMax: spec.gaugeMax,
        wireGaugeMin: spec.gaugeMin
      }
    ],
    connectorFamilyConflicts: spec.family.startsWith("JST PH") && index > 1
      ? [
          {
            candidateConnectorFamilyId: "cf-ci-jst-ph",
            candidatePartId: "part-ci-jst-ph-housing",
            confidenceScore: 0.74,
            conflictType: "family_confusion",
            detail: "Seeded PH sealed variant intentionally remains near the unsealed PH family so resolver warnings keep family confusion separate from buildability.",
            id: `conflict-ci-${slug}`,
            lastUpdatedAt: "2026-04-12T00:00:00.000Z",
            partId: connectorId,
            sourceRecordId: null,
            summary: "JST PH sealed and unsealed families need review before substitution."
          }
        ]
      : [],
    mateRelations: [
      {
        compatibilityStatus: "probable",
        confidenceScore: 0.88,
        evidenceKind: "catalog_fixture",
        id: `mate-ci-${slug}-best`,
        matePartId: mateId,
        notes: "Deterministic local fixture best-mate row for resolver bootstrap.",
        partId: connectorId,
        relationshipType: "best_mate",
        sourceRecordId: null,
        sourceRevisionId
      }
    ]
  };

  return records;
}

/**
 * Builds one manufacturer row for connector-intelligence seed records.
 */
function buildConnectorSeedManufacturer(name: string): Manufacturer {
  return {
    aliases: [name],
    id: `mfr-ci-${slugify(name)}`,
    name,
    website: null
  };
}

/**
 * Builds one local-catalog connector seed record with no invented file assets.
 */
function buildConnectorSeedRecord(input: {
  category: string;
  connectorFamily: ConnectorFamily;
  description: string;
  manufacturer: Manufacturer;
  mpn: string;
  packageRecord: Package;
  partId: string;
  providerPartKey: string;
  sourceRevisionId: string;
  trustScore: number;
}): LocalCatalogRecord {
  return {
    assets: [],
    datasheet: {
      id: input.sourceRevisionId,
      pageCount: null,
      parseConfidence: 0.7,
      pinTableStatus: "needs_review",
      revisionDate: null,
      revisionLabel: "local fixture"
    },
    connectorFamily: input.connectorFamily,
    manufacturer: input.manufacturer,
    metrics: [],
    package: input.packageRecord,
    part: {
      category: input.category,
      connectorFamilyId: input.connectorFamily.id,
      description: input.description,
      id: input.partId,
      lifecycleStatus: "active",
      mpn: input.mpn,
      trustScore: input.trustScore
    },
    providerPartKey: input.providerPartKey,
    sourceUrl: null
  };
}

/**
 * Builds one connector accessory/tooling relation for deterministic seed records.
 */
function buildAccessoryRequirement(
  id: string,
  partId: string,
  accessoryPartId: string,
  relationshipType: AccessoryRequirement["relationshipType"],
  sourceRevisionId: string,
  notes: string
): AccessoryRequirement {
  return {
    accessoryPartId,
    compatibilityStatus: "probable",
    confidenceScore: relationshipType === "requires_accessory" ? 0.84 : 0.78,
    evidenceKind: "catalog_fixture",
    id,
    notes,
    partId,
    relationshipType,
    sourceRecordId: null,
    sourceRevisionId
  };
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

/**
 * Normalizes optional fixture integers while rejecting non-finite values.
 */
function normalizeNullableInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Normalizes optional fixture quantities that must satisfy positive database checks.
 */
function normalizePositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
}

/**
 * Normalizes optional fixture prices that must satisfy non-negative database checks.
 */
function normalizeNonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Normalizes fixture currency codes to the database constraint shape.
 */
function normalizeCurrencyCode(value: string | null | undefined): string {
  const candidate = value?.trim().toUpperCase() ?? "USD";

  return /^[A-Z]{3}$/u.test(candidate) ? candidate : "USD";
}

/**
 * Converts provider keys into deterministic lowercase id fragments.
 */
function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
}
