/**
 * File header: Provides provider-neutral seed fallback data for connector intelligence and asset workflows.
 */

import type {
  AccessoryRequirement,
  Asset,
  AssetPromotionAuditRecord,
  AssetValidationRecord,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorFamily,
  GenerationRequest,
  DatasheetRevision,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartMetric,
  ReviewRecord,
  SimilarPartRelation,
  SourceExtractionSignal,
  SourceRecord
} from "./types";
import { withCanonicalAssetTruth } from "./asset-state";

/** LAST_UPDATED_AT keeps seed timestamps deterministic for repeatable local runs. */
const LAST_UPDATED_AT = "2026-04-12T00:00:00.000Z";

/** manufacturers provide the normalized maker records used by seed parts. */
export const manufacturers = [
  { aliases: ["TE"], id: "mfr-te-connectivity", name: "TE Connectivity", website: "https://www.te.com" },
  { aliases: ["Molex"], id: "mfr-molex", name: "Molex", website: "https://www.molex.com" },
  { aliases: ["TI"], id: "mfr-texas-instruments", name: "Texas Instruments", website: "https://www.ti.com" },
  { aliases: ["Murata"], id: "mfr-murata", name: "Murata", website: "https://www.murata.com" },
  { aliases: ["ST"], id: "mfr-stmicroelectronics", name: "STMicroelectronics", website: "https://www.st.com" }
] satisfies Manufacturer[];

/** connectorFamilies groups connector records without exposing provider-specific names. */
export const connectorFamilies = [
  {
    description: "1.27 mm board-to-wire connector system for compact internal harnesses.",
    id: "cf-micro-match-1-27",
    name: "Micro-MaTch",
    series: "Micro-MaTch 1.27 mm"
  }
] satisfies ConnectorFamily[];

/** partPackages contains deterministic package records for the fallback catalog. */
export const partPackages = [
  { bodyHeightMm: 8.3, bodyLengthMm: 12.0, bodyWidthMm: 5.0, id: "pkg-micro-match-8", packageName: "Micro-MaTch 8-pos", pinCount: 8, pitchMm: 1.27 },
  { bodyHeightMm: 8.1, bodyLengthMm: 12.1, bodyWidthMm: 5.1, id: "pkg-micro-match-8-header", packageName: "Micro-MaTch Header 8-pos", pinCount: 8, pitchMm: 1.27 },
  { bodyHeightMm: 1.45, bodyLengthMm: 2.9, bodyWidthMm: 1.6, id: "pkg-sot-23-5", packageName: "SOT-23-5", pinCount: 5, pitchMm: 0.95 },
  { bodyHeightMm: 0.8, bodyLengthMm: 1.6, bodyWidthMm: 0.8, id: "pkg-0603", packageName: "0603", pinCount: 2, pitchMm: null },
  { bodyHeightMm: 0.6, bodyLengthMm: 5, bodyWidthMm: 5, id: "pkg-qfn-32", packageName: "QFN-32", pinCount: 32, pitchMm: 0.5 }
] satisfies Package[];

/** parts seed connector and non-connector records for search, detail, and export states. */
export const parts = [
  {
    category: "Connector",
    connectorFamilyId: "cf-micro-match-1-27",
    id: "part-te-215079-8",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-te-connectivity",
    mpn: "215079-8",
    packageId: "pkg-micro-match-8",
    trustScore: 0.84
  },
  {
    category: "Connector",
    connectorFamilyId: "cf-micro-match-1-27",
    id: "part-te-215083-8",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-te-connectivity",
    mpn: "215083-8",
    packageId: "pkg-micro-match-8-header",
    trustScore: 0.82
  },
  {
    category: "Connector accessory",
    connectorFamilyId: "cf-micro-match-1-27",
    id: "part-te-215460-8",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-te-connectivity",
    mpn: "215460-8",
    packageId: "pkg-micro-match-8",
    trustScore: 0.75
  },
  {
    category: "Connector accessory",
    connectorFamilyId: "cf-micro-match-1-27",
    id: "part-te-215464-1",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-te-connectivity",
    mpn: "215464-1",
    packageId: "pkg-micro-match-8",
    trustScore: 0.74
  },
  {
    category: "Connector tooling",
    connectorFamilyId: "cf-micro-match-1-27",
    id: "part-te-734532-1",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-te-connectivity",
    mpn: "734532-1",
    packageId: "pkg-micro-match-8",
    trustScore: 0.7
  },
  {
    category: "Connector cable",
    connectorFamilyId: "cf-micro-match-1-27",
    id: "part-molex-1513400800",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-molex",
    mpn: "1513400800",
    packageId: "pkg-micro-match-8",
    trustScore: 0.72
  },
  {
    category: "Power management",
    connectorFamilyId: null,
    id: "part-tps7a02dbvr",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-texas-instruments",
    mpn: "TPS7A02DBVR",
    packageId: "pkg-sot-23-5",
    trustScore: 0.82
  },
  {
    category: "Capacitor",
    connectorFamilyId: null,
    id: "part-grm188r71c104ka01d",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-murata",
    mpn: "GRM188R71C104KA01D",
    packageId: "pkg-0603",
    trustScore: 0.78
  },
  {
    category: "Microcontroller",
    connectorFamilyId: null,
    id: "part-stm32g031k8t6",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-stmicroelectronics",
    mpn: "STM32G031K8T6",
    packageId: "pkg-qfn-32",
    trustScore: 0.68
  }
] satisfies Part[];

/** datasheetRevisions attach parse confidence to normalized datasheet metadata. */
export const datasheetRevisions = [
  {
    fileAssetId: "asset-te-215079-8-datasheet",
    id: "dsr-te-215079-8-rev-b",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 18,
    parseConfidence: 0.81,
    pinTableStatus: "needs_review",
    partId: "part-te-215079-8",
    revisionDate: "2025-04-11",
    revisionLabel: "Rev. B",
    sourceRecordId: "source-seed-te-215079-8"
  },
  {
    fileAssetId: "asset-te-215083-8-datasheet",
    id: "dsr-te-215083-8-rev-c",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 16,
    parseConfidence: 0.79,
    pinTableStatus: "not_available",
    partId: "part-te-215083-8",
    revisionDate: "2024-08-02",
    revisionLabel: "Rev. C",
    sourceRecordId: "source-seed-te-215083-8"
  },
  {
    fileAssetId: "asset-tps7a02-datasheet",
    id: "dsr-tps7a02-rev-e",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 39,
    parseConfidence: 0.79,
    pinTableStatus: "available",
    partId: "part-tps7a02dbvr",
    revisionDate: "2024-02-01",
    revisionLabel: "Rev. E",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    fileAssetId: "asset-grm188-datasheet",
    id: "dsr-grm188-series",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 12,
    parseConfidence: 0.72,
    pinTableStatus: "not_available",
    partId: "part-grm188r71c104ka01d",
    revisionDate: "2023-11-15",
    revisionLabel: "Series data",
    sourceRecordId: "source-seed-grm188"
  },
  {
    fileAssetId: "asset-stm32g031-datasheet",
    id: "dsr-stm32g031-rev-7",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 123,
    parseConfidence: 0.66,
    pinTableStatus: "not_available",
    partId: "part-stm32g031k8t6",
    revisionDate: "2024-06-20",
    revisionLabel: "Rev. 7",
    sourceRecordId: "source-seed-stm32g031"
  }
] satisfies DatasheetRevision[];

/** sourceRecords preserve raw-payload provenance for the seed fallback catalog. */
export const sourceRecords = [
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-te-215079-8",
    importErrorDetails: null,
    importStatus: "imported",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-te-215079-8",
    providerId: "seed:local-catalog",
    providerPartKey: "215079-8",
    rawPayload: { mpn: "215079-8" },
    sourceLastImportedAt: LAST_UPDATED_AT,
    sourceLastSeenAt: LAST_UPDATED_AT,
    sourceUrl: "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=215079"
  },
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-te-215083-8",
    importErrorDetails: null,
    importStatus: "imported",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-te-215083-8",
    providerId: "seed:local-catalog",
    providerPartKey: "215083-8",
    rawPayload: { mpn: "215083-8" },
    sourceLastImportedAt: LAST_UPDATED_AT,
    sourceLastSeenAt: LAST_UPDATED_AT,
    sourceUrl: "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=215083"
  },
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-tps7a02",
    importErrorDetails: null,
    importStatus: "imported",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-tps7a02dbvr",
    providerId: "seed:local-catalog",
    providerPartKey: "TPS7A02DBVR",
    rawPayload: { mpn: "TPS7A02DBVR" },
    sourceLastImportedAt: LAST_UPDATED_AT,
    sourceLastSeenAt: LAST_UPDATED_AT,
    sourceUrl: "https://www.ti.com/product/TPS7A02"
  },
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-grm188",
    importErrorDetails: null,
    importStatus: "imported",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-grm188r71c104ka01d",
    providerId: "seed:local-catalog",
    providerPartKey: "GRM188R71C104KA01D",
    rawPayload: { mpn: "GRM188R71C104KA01D" },
    sourceLastImportedAt: LAST_UPDATED_AT,
    sourceLastSeenAt: LAST_UPDATED_AT,
    sourceUrl: "https://www.murata.com/en-us/products/productdetail?partno=GRM188R71C104KA01D"
  },
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-stm32g031",
    importErrorDetails: null,
    importStatus: "imported",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-stm32g031k8t6",
    providerId: "seed:local-catalog",
    providerPartKey: "STM32G031K8T6",
    rawPayload: { mpn: "STM32G031K8T6" },
    sourceLastImportedAt: LAST_UPDATED_AT,
    sourceLastSeenAt: LAST_UPDATED_AT,
    sourceUrl: "https://www.st.com/en/microcontrollers-microprocessors/stm32g031k8.html"
  }
] satisfies SourceRecord[];

/** sourceExtractionSignals seed explicit CAD-recovery source evidence without claiming full PDF parsing. */
export const sourceExtractionSignals = [
  {
    assetId: "asset-tps7a02-datasheet",
    confidenceScore: 0.78,
    datasheetRevisionId: "dsr-tps7a02-rev-e",
    extractionSource: "datasheet_metadata",
    extractionStatus: "available",
    id: "sig-tps7a02-package-mechanical",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Package pin count, pitch, and body dimensions are normalized from reviewed package metadata.",
    partId: "part-tps7a02dbvr",
    signalType: "package_mechanical_dimensions",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    assetId: "asset-tps7a02-datasheet",
    confidenceScore: 0.74,
    datasheetRevisionId: "dsr-tps7a02-rev-e",
    extractionSource: "datasheet_metadata",
    extractionStatus: "available",
    id: "sig-tps7a02-pin-table",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Pin table is available as structured source evidence for a symbol request.",
    partId: "part-tps7a02dbvr",
    signalType: "pin_table",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    assetId: "asset-tps7a02-mechanical",
    confidenceScore: 0.68,
    datasheetRevisionId: "dsr-tps7a02-rev-e",
    extractionSource: "asset_reference",
    extractionStatus: "needs_review",
    id: "sig-tps7a02-mechanical-drawing",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Mechanical drawing reference exists, but geometry extraction remains review-required.",
    partId: "part-tps7a02dbvr",
    signalType: "mechanical_drawing",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    assetId: "asset-stm32g031-datasheet",
    confidenceScore: 0.66,
    datasheetRevisionId: "dsr-stm32g031-rev-7",
    extractionSource: "datasheet_metadata",
    extractionStatus: "available",
    id: "sig-stm32g031-package-mechanical",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "QFN package dimensions are normalized, but this does not imply symbol or 3D readiness.",
    partId: "part-stm32g031k8t6",
    signalType: "package_mechanical_dimensions",
    sourceRecordId: "source-seed-stm32g031"
  },
  {
    assetId: "asset-stm32g031-datasheet",
    confidenceScore: 0,
    datasheetRevisionId: "dsr-stm32g031-rev-7",
    extractionSource: "datasheet_metadata",
    extractionStatus: "not_available",
    id: "sig-stm32g031-pin-table",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "No reviewed pin-table extraction is available yet.",
    partId: "part-stm32g031k8t6",
    signalType: "pin_table",
    sourceRecordId: "source-seed-stm32g031"
  },
  {
    assetId: null,
    confidenceScore: 0,
    datasheetRevisionId: "dsr-stm32g031-rev-7",
    extractionSource: "datasheet_metadata",
    extractionStatus: "not_available",
    id: "sig-stm32g031-mechanical-drawing",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "No usable mechanical drawing extraction signal is available for 3D generation.",
    partId: "part-stm32g031k8t6",
    signalType: "mechanical_drawing",
    sourceRecordId: "source-seed-stm32g031"
  }
] satisfies SourceExtractionSignal[];

/** partMetrics seed normalized values and confidence scores from datasheet revisions. */
export const partMetrics = [
  {
    confidenceScore: 0.83,
    id: "metric-te-215079-current-rating",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "current_rating_per_contact",
    metricValue: 2,
    minValue: null,
    partId: "part-te-215079-8",
    sourceRecordId: "source-seed-te-215079-8",
    sourceRevisionId: "dsr-te-215079-8-rev-b",
    unit: "A"
  },
  {
    confidenceScore: 0.81,
    id: "metric-te-215079-voltage-rating",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "voltage_rating",
    metricValue: 100,
    minValue: null,
    partId: "part-te-215079-8",
    sourceRecordId: "source-seed-te-215079-8",
    sourceRevisionId: "dsr-te-215079-8-rev-b",
    unit: "V"
  },
  {
    confidenceScore: 0.76,
    id: "metric-te-215079-operating-temperature",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: 105,
    metricKey: "operating_temperature",
    metricValue: null,
    minValue: -40,
    partId: "part-te-215079-8",
    sourceRecordId: "source-seed-te-215079-8",
    sourceRevisionId: "dsr-te-215079-8-rev-b",
    unit: "deg C"
  },
  {
    confidenceScore: 0.83,
    id: "metric-tps7a02-input-voltage-max",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "input_voltage_max",
    metricValue: 5.5,
    minValue: null,
    partId: "part-tps7a02dbvr",
    sourceRecordId: "source-seed-tps7a02",
    sourceRevisionId: "dsr-tps7a02-rev-e",
    unit: "V"
  },
  {
    confidenceScore: 0.81,
    id: "metric-tps7a02-output-current-max",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "output_current_max",
    metricValue: 0.2,
    minValue: null,
    partId: "part-tps7a02dbvr",
    sourceRecordId: "source-seed-tps7a02",
    sourceRevisionId: "dsr-tps7a02-rev-e",
    unit: "A"
  },
  {
    confidenceScore: 0.76,
    id: "metric-grm188-capacitance",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "capacitance",
    metricValue: 0.0000001,
    minValue: null,
    partId: "part-grm188r71c104ka01d",
    sourceRecordId: "source-seed-grm188",
    sourceRevisionId: "dsr-grm188-series",
    unit: "F"
  },
  {
    confidenceScore: 0.74,
    id: "metric-grm188-rated-voltage",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "rated_voltage",
    metricValue: 16,
    minValue: null,
    partId: "part-grm188r71c104ka01d",
    sourceRecordId: "source-seed-grm188",
    sourceRevisionId: "dsr-grm188-series",
    unit: "V"
  },
  {
    confidenceScore: 0.71,
    id: "metric-stm32g031-supply-voltage",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: 3.6,
    metricKey: "supply_voltage",
    metricValue: null,
    minValue: 2,
    partId: "part-stm32g031k8t6",
    sourceRecordId: "source-seed-stm32g031",
    sourceRevisionId: "dsr-stm32g031-rev-7",
    unit: "V"
  },
  {
    confidenceScore: 0.67,
    id: "metric-stm32g031-clock-frequency-max",
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: "clock_frequency_max",
    metricValue: 64000000,
    minValue: null,
    partId: "part-stm32g031k8t6",
    sourceRecordId: "source-seed-stm32g031",
    sourceRevisionId: "dsr-stm32g031-rev-7",
    unit: "Hz"
  }
] satisfies PartMetric[];

/** seedAssetRows keep legacy mirrors so local fallback can exercise upgrade behavior. */
const seedAssetRows = [
  {
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-te-215079-8-datasheet",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-te-215079-8",
    previewStatus: "not_available",
    providerId: "seed:official-datasheet",
    provenance: "official",
    sourceRecordId: "source-seed-te-215079-8",
    sourceUrl: "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=215079",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetState: "validated",
    assetStatus: "verified_for_export",
    assetType: "footprint",
    fileFormat: "kicad_mod",
    fileHash: "sha256:seed-footprint-215079",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-te-215079-8-footprint",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-te-215079-8",
    previewStatus: "ready",
    providerId: "seed:internal-library",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-te-215079-8",
    sourceUrl: null,
    storageKey: "cad/part-te-215079-8/footprint.kicad_mod",
    validationStatus: "verified"
  },
  {
    assetState: "validated",
    assetStatus: "verified_for_export",
    assetType: "symbol",
    fileFormat: "kicad_sym",
    fileHash: "sha256:seed-symbol-215079",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-te-215079-8-symbol",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-te-215079-8",
    previewStatus: "ready",
    providerId: "seed:internal-library",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-te-215079-8",
    sourceUrl: null,
    storageKey: "cad/part-te-215079-8/symbol.kicad_sym",
    validationStatus: "verified"
  },
  {
    assetState: "validated",
    assetStatus: "reviewed",
    assetType: "three_d_model",
    fileFormat: "step",
    fileHash: "sha256:seed-step-215079",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-te-215079-8-3d",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-te-215079-8",
    previewStatus: "ready",
    providerId: "seed:trusted-cad",
    provenance: "trusted_external",
    sourceRecordId: "source-seed-te-215079-8",
    sourceUrl: null,
    storageKey: "cad/part-te-215079-8/model.step",
    validationStatus: "verified"
  },
  {
    assetState: "referenced",
    assetStatus: "referenced",
    assetType: "mechanical_drawing",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-te-215079-8-mechanical",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-te-215079-8",
    previewStatus: "not_available",
    providerId: "seed:official-drawing",
    provenance: "official",
    sourceRecordId: "source-seed-te-215079-8",
    sourceUrl: "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=215079",
    storageKey: null,
    validationStatus: "not_validated"
  },
  {
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-te-215083-8-datasheet",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-te-215083-8",
    previewStatus: "not_available",
    providerId: "seed:official-datasheet",
    provenance: "official",
    sourceRecordId: "source-seed-te-215083-8",
    sourceUrl: "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=215083",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-tps7a02-datasheet",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-tps7a02dbvr",
    previewStatus: "not_available",
    providerId: "seed:official-datasheet",
    provenance: "official",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetState: "missing",
    assetStatus: "missing",
    assetType: "footprint",
    fileFormat: "unknown",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-tps7a02-footprint",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "unknown",
    partId: "part-tps7a02dbvr",
    previewStatus: "not_available",
    providerId: "seed:missing",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: null,
    storageKey: null,
    validationStatus: "not_validated"
  },
  {
    assetState: "missing",
    assetStatus: "missing",
    assetType: "symbol",
    fileFormat: "unknown",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-tps7a02-symbol",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "unknown",
    partId: "part-tps7a02dbvr",
    previewStatus: "not_available",
    providerId: "seed:missing",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: null,
    storageKey: null,
    validationStatus: "not_validated"
  },
  {
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "mechanical_drawing",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-tps7a02-mechanical",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-tps7a02dbvr",
    previewStatus: "not_available",
    providerId: "seed:official-drawing",
    provenance: "official",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: "https://www.ti.com/lit/ml/mpds026/mpds026.pdf",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType: "three_d_model",
    fileFormat: "step",
    fileHash: "sha256:seed-review-tps7a02-3d",
    generationMethod: "mechanical_drawing_request",
    generationSourceAssetId: "asset-tps7a02-mechanical",
    id: "asset-tps7a02-3d",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-tps7a02dbvr",
    previewStatus: "pending",
    providerId: "seed:generation-workflow",
    provenance: "generated",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: null,
    storageKey: "generated/part-tps7a02dbvr/model-review.step",
    validationStatus: "needs_review"
  },
  {
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-grm188-datasheet",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-grm188r71c104ka01d",
    previewStatus: "not_available",
    providerId: "seed:official-datasheet",
    provenance: "official",
    sourceRecordId: "source-seed-grm188",
    sourceUrl: "https://www.murata.com/en-us/products/productdetail?partno=GRM188R71C104KA01D",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetState: "validated",
    assetStatus: "verified_for_export",
    assetType: "footprint",
    fileFormat: "kicad_mod",
    fileHash: "sha256:seed-footprint-grm188",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-grm188-footprint",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-grm188r71c104ka01d",
    previewStatus: "ready",
    providerId: "seed:internal-library",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-grm188",
    sourceUrl: null,
    storageKey: "cad/part-grm188r71c104ka01d/footprint.kicad_mod",
    validationStatus: "verified"
  },
  {
    assetState: "validated",
    assetStatus: "verified_for_export",
    assetType: "symbol",
    fileFormat: "kicad_sym",
    fileHash: "sha256:seed-symbol-grm188",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-grm188-symbol",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-grm188r71c104ka01d",
    previewStatus: "ready",
    providerId: "seed:internal-library",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-grm188",
    sourceUrl: null,
    storageKey: "cad/part-grm188r71c104ka01d/symbol.kicad_sym",
    validationStatus: "verified"
  },
  {
    assetState: "validated",
    assetStatus: "verified_for_export",
    assetType: "three_d_model",
    fileFormat: "step",
    fileHash: "sha256:seed-step-grm188",
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-grm188-3d",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "redistribution_allowed",
    partId: "part-grm188r71c104ka01d",
    previewStatus: "ready",
    providerId: "seed:internal-library",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-grm188",
    sourceUrl: null,
    storageKey: "cad/part-grm188r71c104ka01d/model.step",
    validationStatus: "verified"
  },
  {
    assetState: "referenced",
    assetStatus: "reviewed",
    assetType: "datasheet",
    fileFormat: "pdf",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-stm32g031-datasheet",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "metadata_only",
    partId: "part-stm32g031k8t6",
    previewStatus: "not_available",
    providerId: "seed:official-datasheet",
    provenance: "official",
    sourceRecordId: "source-seed-stm32g031",
    sourceUrl: "https://www.st.com/resource/en/datasheet/stm32g031k8.pdf",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetState: "failed",
    assetStatus: "failed",
    assetType: "three_d_model",
    fileFormat: "unknown",
    fileHash: null,
    generationMethod: null,
    generationSourceAssetId: null,
    id: "asset-stm32g031-3d",
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "unknown",
    partId: "part-stm32g031k8t6",
    previewStatus: "not_available",
    providerId: "seed:missing",
    provenance: "manual_internal",
    sourceRecordId: "source-seed-stm32g031",
    sourceUrl: null,
    storageKey: null,
    validationStatus: "failed"
  }
] satisfies Omit<Asset, "availabilityStatus" | "exportStatus" | "reviewStatus">[];

/** assets keep provenance, availability, review, and export verification explicitly separate. */
export const assets = seedAssetRows.map(withCanonicalAssetTruth) satisfies Asset[];

/** mateRelations seed direct connector mating relationships with confidence. */
export const mateRelations = [
  {
    confidenceScore: 0.94,
    id: "mate-te-215079-best",
    matePartId: "part-te-215083-8",
    notes: "Primary mating header per mechanical keying and retention geometry.",
    partId: "part-te-215079-8",
    relationshipType: "best_mate",
    sourceRevisionId: "dsr-te-215079-8-rev-b"
  }
] satisfies MateRelation[];

/** accessoryRequirements seed required accessories and tooling for a buildable set. */
export const accessoryRequirements = [
  {
    accessoryPartId: "part-te-215460-8",
    confidenceScore: 0.89,
    id: "acc-te-215079-required-1",
    notes: "Strain relief required for rated cable pull force.",
    partId: "part-te-215079-8",
    relationshipType: "requires_accessory",
    sourceRevisionId: "dsr-te-215079-8-rev-b"
  },
  {
    accessoryPartId: "part-te-215464-1",
    confidenceScore: 0.83,
    id: "acc-te-215079-required-2",
    notes: "Locking clip required for vibration environments.",
    partId: "part-te-215079-8",
    relationshipType: "requires_accessory",
    sourceRevisionId: "dsr-te-215079-8-rev-b"
  },
  {
    accessoryPartId: "part-te-734532-1",
    confidenceScore: 0.9,
    id: "acc-te-215079-tooling-1",
    notes: "Crimp tooling required for production assembly quality.",
    partId: "part-te-215079-8",
    relationshipType: "tooling_requirement",
    sourceRevisionId: "dsr-te-215079-8-rev-b"
  }
] satisfies AccessoryRequirement[];

/** cableCompatibilities seed compatible cable options for connector assembly. */
export const cableCompatibilities = [
  {
    cablePartId: "part-molex-1513400800",
    confidenceScore: 0.78,
    id: "cable-te-215079-1",
    notes: "Compatible ribbon cable option for 8-pos harness prototypes.",
    partId: "part-te-215079-8",
    relationshipType: "supports_cable",
    sourceRevisionId: "dsr-te-215079-8-rev-b"
  }
] satisfies CableCompatibility[];

/** similarPartRelations seed alternatives without implying drop-in equivalence. */
export const similarPartRelations = [
  {
    confidenceScore: 0.81,
    id: "sim-te-215079-1",
    partId: "part-te-215079-8",
    reason: "Same family, same pitch, alternate shell style.",
    similarPartId: "part-te-215083-8"
  }
] satisfies SimilarPartRelation[];

/** companionRecommendations seed low-confidence design-context suggestions. */
export const companionRecommendations = [
  {
    companionPartId: "part-tps7a02dbvr",
    confidenceScore: 0.63,
    id: "comp-te-215079-1",
    partId: "part-te-215079-8",
    usageContext: "Often paired in low-power sensor board harness interfaces."
  }
] satisfies CompanionRecommendation[];

/** generationWorkflows seed future CAD generation state without pretending files exist. */
export const generationWorkflows = [
  {
    confidenceScore: 0.86,
    generationStatus: "available_to_request",
    id: "gen-te-215079-footprint",
    outputAssetId: null,
    partId: "part-te-215079-8",
    sourceAssetId: "asset-te-215079-8-mechanical",
    sourceDatasheetRevisionId: "dsr-te-215079-8-rev-b",
    targetAssetType: "footprint"
  },
  {
    confidenceScore: 0.77,
    generationStatus: "available_to_request",
    id: "gen-tps7a02-footprint",
    outputAssetId: "asset-tps7a02-footprint",
    partId: "part-tps7a02dbvr",
    sourceAssetId: "asset-tps7a02-datasheet",
    sourceDatasheetRevisionId: "dsr-tps7a02-rev-e",
    targetAssetType: "footprint"
  },
  {
    confidenceScore: 0.74,
    generationStatus: "available_to_request",
    id: "gen-tps7a02-symbol",
    outputAssetId: "asset-tps7a02-symbol",
    partId: "part-tps7a02dbvr",
    sourceAssetId: "asset-tps7a02-datasheet",
    sourceDatasheetRevisionId: "dsr-tps7a02-rev-e",
    targetAssetType: "symbol"
  },
  {
    confidenceScore: 0.72,
    generationStatus: "review_required",
    id: "gen-tps7a02-3d",
    outputAssetId: "asset-tps7a02-3d",
    partId: "part-tps7a02dbvr",
    sourceAssetId: "asset-tps7a02-mechanical",
    sourceDatasheetRevisionId: "dsr-tps7a02-rev-e",
    targetAssetType: "three_d_model"
  }
] satisfies GenerationWorkflow[];

/** generationRequests seed persisted request state without simulating approved outputs. */
export const generationRequests = [
  {
    id: "genreq-tps7a02-3d-review",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-tps7a02dbvr",
    requestedAt: LAST_UPDATED_AT,
    requestedBy: "seed:local-review",
    requestStatus: "review_required",
    sourceAssetId: "asset-tps7a02-mechanical",
    sourceDatasheetRevisionId: "dsr-tps7a02-rev-e",
    targetAssetType: "three_d_model",
    workflowId: "gen-tps7a02-3d"
  }
] satisfies GenerationRequest[];

/** reviewRecords seed explicit review decisions without auto-verifying every reviewed asset. */
export const reviewRecords = [
  {
    assetId: "asset-te-215079-8-footprint",
    generationWorkflowId: null,
    id: "review-asset-te-215079-footprint-approved",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Internal footprint passed review and is allowed in export bundles.",
    outcome: "approved",
    partId: "part-te-215079-8",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-te-215079-8-symbol",
    generationWorkflowId: null,
    id: "review-asset-te-215079-symbol-approved",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Internal symbol passed review and is allowed in export bundles.",
    outcome: "approved",
    partId: "part-te-215079-8",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-te-215079-8-3d",
    generationWorkflowId: null,
    id: "review-asset-te-215079-3d-approved-not-export",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Geometry was reviewed, but export verification remains separate.",
    outcome: "approved",
    partId: "part-te-215079-8",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-grm188-footprint",
    generationWorkflowId: null,
    id: "review-asset-grm188-footprint-approved",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Internal footprint passed review and is allowed in export bundles.",
    outcome: "approved",
    partId: "part-grm188r71c104ka01d",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-grm188-symbol",
    generationWorkflowId: null,
    id: "review-asset-grm188-symbol-approved",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Internal symbol passed review and is allowed in export bundles.",
    outcome: "approved",
    partId: "part-grm188r71c104ka01d",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-grm188-3d",
    generationWorkflowId: null,
    id: "review-asset-grm188-3d-approved",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Internal 3D model passed review and is allowed in export bundles.",
    outcome: "approved",
    partId: "part-grm188r71c104ka01d",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-tps7a02-mechanical",
    generationWorkflowId: null,
    id: "review-asset-tps7a02-mechanical-changes",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "Mechanical drawing reference needs source-page confirmation before reuse.",
    outcome: "changes_requested",
    partId: "part-tps7a02dbvr",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  },
  {
    assetId: "asset-stm32g031-3d",
    generationWorkflowId: null,
    id: "review-asset-stm32g031-3d-rejected",
    lastUpdatedAt: LAST_UPDATED_AT,
    notes: "No usable 3D source was available for review.",
    outcome: "rejected",
    partId: "part-stm32g031k8t6",
    reviewedAt: LAST_UPDATED_AT,
    reviewer: "seed:library-review",
    targetType: "asset"
  }
] satisfies ReviewRecord[];

/** assetValidationRecords seed durable evidence for export-promotion and trust UI examples. */
export const assetValidationRecords = [
  {
    assetId: "asset-te-215079-8-footprint",
    id: "validation-te-215079-footprint-geometry",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-te-215079-8",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "Pad geometry, pitch, and courtyard were checked against reviewed package dimensions.",
    validationStatus: "verified",
    validationType: "footprint_geometry",
    validator: "seed:library-validation"
  },
  {
    assetId: "asset-te-215079-8-symbol",
    id: "validation-te-215079-symbol-pins",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-te-215079-8",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "Pin count and connector numbering were checked against the datasheet table.",
    validationStatus: "verified",
    validationType: "symbol_pin_mapping",
    validator: "seed:library-validation"
  },
  {
    assetId: "asset-te-215079-8-3d",
    id: "validation-te-215079-3d-manual",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-te-215079-8",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "Model geometry was reviewed, but export promotion has not been performed.",
    validationStatus: "verified",
    validationType: "three_d_geometry",
    validator: "seed:library-validation"
  },
  {
    assetId: "asset-grm188-footprint",
    id: "validation-grm188-footprint-geometry",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-grm188r71c104ka01d",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "Footprint dimensions match the internal capacitor package rule.",
    validationStatus: "verified",
    validationType: "footprint_geometry",
    validator: "seed:library-validation"
  },
  {
    assetId: "asset-grm188-symbol",
    id: "validation-grm188-symbol-pins",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-grm188r71c104ka01d",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "Passive two-pin symbol mapping was checked.",
    validationStatus: "verified",
    validationType: "symbol_pin_mapping",
    validator: "seed:library-validation"
  },
  {
    assetId: "asset-grm188-3d",
    id: "validation-grm188-3d-geometry",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-grm188r71c104ka01d",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "STEP body envelope was checked against 0603 package dimensions.",
    validationStatus: "verified",
    validationType: "three_d_geometry",
    validator: "seed:library-validation"
  },
  {
    assetId: "asset-tps7a02-3d",
    id: "validation-tps7a02-3d-review-needed",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-tps7a02dbvr",
    validatedAt: LAST_UPDATED_AT,
    validationNotes: "Generated model exists but still needs engineering validation before promotion.",
    validationStatus: "needs_review",
    validationType: "three_d_geometry",
    validator: "seed:generation-workflow"
  }
] satisfies AssetValidationRecord[];

/** assetPromotionAudits seed historical promotion attempts without changing asset state by inference. */
export const assetPromotionAudits = [
  {
    actor: "seed:library-promotion",
    assetId: "asset-grm188-footprint",
    blockerReasons: [],
    createdAt: LAST_UPDATED_AT,
    id: "promotion-grm188-footprint-promoted",
    newExportStatus: "verified_for_export",
    partId: "part-grm188r71c104ka01d",
    priorExportStatus: "not_exportable",
    promotionOutcome: "promoted",
    validationRecordId: "validation-grm188-footprint-geometry"
  },
  {
    actor: "seed:library-promotion",
    assetId: "asset-te-215079-8-3d",
    blockerReasons: ["Approved review exists, but export verification was not promoted yet."],
    createdAt: LAST_UPDATED_AT,
    id: "promotion-te-215079-3d-denied",
    newExportStatus: "partially_exportable",
    partId: "part-te-215079-8",
    priorExportStatus: "partially_exportable",
    promotionOutcome: "denied",
    validationRecordId: null
  }
] satisfies AssetPromotionAuditRecord[];
