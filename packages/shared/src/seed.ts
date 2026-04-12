/**
 * File header: Provides small provider-neutral seed fallback data for screens and APIs.
 */

import type { Asset, DatasheetRevision, Manufacturer, Package, Part, PartMetric, SourceRecord } from "./types";

/** LAST_UPDATED_AT keeps seed timestamps deterministic for repeatable local runs. */
const LAST_UPDATED_AT = "2026-04-12T00:00:00.000Z";

/** Manufacturers seed search filters and joined part records. */
export const manufacturers = [
  {
    aliases: ["TI"],
    id: "mfr-texas-instruments",
    name: "Texas Instruments",
    website: "https://www.ti.com"
  },
  {
    aliases: ["Murata Manufacturing"],
    id: "mfr-murata",
    name: "Murata",
    website: "https://www.murata.com"
  },
  {
    aliases: ["ST"],
    id: "mfr-stmicroelectronics",
    name: "STMicroelectronics",
    website: "https://www.st.com"
  }
] satisfies Manufacturer[];

/** Packages seed normalized package dimensions in millimeters. */
export const partPackages = [
  {
    bodyHeightMm: 1.45,
    bodyLengthMm: 2.9,
    bodyWidthMm: 1.6,
    id: "pkg-sot-23-5",
    packageName: "SOT-23-5",
    pinCount: 5,
    pitchMm: 0.95
  },
  {
    bodyHeightMm: 0.8,
    bodyLengthMm: 1.6,
    bodyWidthMm: 0.8,
    id: "pkg-0603",
    packageName: "0603",
    pinCount: 2,
    pitchMm: null
  },
  {
    bodyHeightMm: 0.6,
    bodyLengthMm: 5,
    bodyWidthMm: 5,
    id: "pkg-qfn-32",
    packageName: "QFN-32",
    pinCount: 32,
    pitchMm: 0.5
  }
] satisfies Package[];

/** Parts seed realistic search and detail page records without provider-specific branches. */
export const parts = [
  {
    category: "Power management",
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
    id: "part-grm188r71c104ka01d",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-murata",
    mpn: "GRM188R71C104KA01D",
    packageId: "pkg-0603",
    trustScore: 0.74
  },
  {
    category: "Microcontroller",
    id: "part-stm32g031k8t6",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-stmicroelectronics",
    mpn: "STM32G031K8T6",
    packageId: "pkg-qfn-32",
    trustScore: 0.68
  }
] satisfies Part[];

/** Datasheet revisions seed provenance for the normalized metrics. */
export const datasheetRevisions = [
  {
    fileAssetId: "asset-tps7a02-datasheet",
    id: "dsr-tps7a02-rev-e",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 39,
    parseConfidence: 0.79,
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
    partId: "part-stm32g031k8t6",
    revisionDate: "2024-06-20",
    revisionLabel: "Rev. 7",
    sourceRecordId: "source-seed-stm32g031"
  }
] satisfies DatasheetRevision[];

/** Source records seed raw payload provenance for Phase 2 fallback records. */
export const sourceRecords = [
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-tps7a02",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-tps7a02dbvr",
    providerId: "seed:local-catalog",
    providerPartKey: "TPS7A02DBVR",
    rawPayload: { mpn: "TPS7A02DBVR" },
    sourceUrl: "https://www.ti.com/product/TPS7A02"
  },
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-grm188",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-grm188r71c104ka01d",
    providerId: "seed:local-catalog",
    providerPartKey: "GRM188R71C104KA01D",
    rawPayload: { mpn: "GRM188R71C104KA01D" },
    sourceUrl: "https://www.murata.com/en-us/products/productdetail?partno=GRM188R71C104KA01D"
  },
  {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-seed-stm32g031",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-stm32g031k8t6",
    providerId: "seed:local-catalog",
    providerPartKey: "STM32G031K8T6",
    rawPayload: { mpn: "STM32G031K8T6" },
    sourceUrl: "https://www.st.com/en/microcontrollers-microprocessors/stm32g031k8.html"
  }
] satisfies SourceRecord[];

/** Metrics seed normalized values and confidence scores from the datasheet revisions. */
export const partMetrics = [
  {
    confidenceScore: 0.83,
    id: "metric-tps7a02-input-voltage-max",
    maxValue: null,
    metricKey: "input_voltage_max",
    metricValue: 5.5,
    minValue: null,
    partId: "part-tps7a02dbvr",
    lastUpdatedAt: LAST_UPDATED_AT,
    sourceRecordId: "source-seed-tps7a02",
    sourceRevisionId: "dsr-tps7a02-rev-e",
    unit: "V"
  },
  {
    confidenceScore: 0.81,
    id: "metric-tps7a02-output-current-max",
    maxValue: null,
    metricKey: "output_current_max",
    metricValue: 0.2,
    minValue: null,
    partId: "part-tps7a02dbvr",
    lastUpdatedAt: LAST_UPDATED_AT,
    sourceRecordId: "source-seed-tps7a02",
    sourceRevisionId: "dsr-tps7a02-rev-e",
    unit: "A"
  },
  {
    confidenceScore: 0.76,
    id: "metric-grm188-capacitance",
    maxValue: null,
    metricKey: "capacitance",
    metricValue: 0.0000001,
    minValue: null,
    partId: "part-grm188r71c104ka01d",
    lastUpdatedAt: LAST_UPDATED_AT,
    sourceRecordId: "source-seed-grm188",
    sourceRevisionId: "dsr-grm188-series",
    unit: "F"
  },
  {
    confidenceScore: 0.74,
    id: "metric-grm188-rated-voltage",
    maxValue: null,
    metricKey: "rated_voltage",
    metricValue: 16,
    minValue: null,
    partId: "part-grm188r71c104ka01d",
    lastUpdatedAt: LAST_UPDATED_AT,
    sourceRecordId: "source-seed-grm188",
    sourceRevisionId: "dsr-grm188-series",
    unit: "V"
  },
  {
    confidenceScore: 0.71,
    id: "metric-stm32g031-supply-voltage",
    maxValue: 3.6,
    metricKey: "supply_voltage",
    metricValue: null,
    minValue: 2,
    partId: "part-stm32g031k8t6",
    lastUpdatedAt: LAST_UPDATED_AT,
    sourceRecordId: "source-seed-stm32g031",
    sourceRevisionId: "dsr-stm32g031-rev-7",
    unit: "V"
  },
  {
    confidenceScore: 0.67,
    id: "metric-stm32g031-clock-frequency-max",
    maxValue: null,
    metricKey: "clock_frequency_max",
    metricValue: 64000000,
    minValue: null,
    partId: "part-stm32g031k8t6",
    lastUpdatedAt: LAST_UPDATED_AT,
    sourceRecordId: "source-seed-stm32g031",
    sourceRevisionId: "dsr-stm32g031-rev-7",
    unit: "Hz"
  }
] satisfies PartMetric[];

/** Assets seed metadata-only records so export availability never implies missing files exist. */
export const assets = [
  {
    assetType: "datasheet",
    assetState: "referenced",
    fileFormat: "pdf",
    fileHash: null,
    id: "asset-tps7a02-datasheet",
    licenseMode: "metadata_only",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-tps7a02dbvr",
    previewStatus: "not_available",
    providerId: "seed:datasheet-metadata",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetType: "footprint",
    assetState: "missing",
    fileFormat: "unknown",
    fileHash: null,
    id: "asset-tps7a02-footprint",
    licenseMode: "unknown",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-tps7a02dbvr",
    previewStatus: "not_available",
    providerId: "seed:cad-metadata",
    sourceRecordId: "source-seed-tps7a02",
    sourceUrl: null,
    storageKey: null,
    validationStatus: "not_validated"
  },
  {
    assetType: "datasheet",
    assetState: "referenced",
    fileFormat: "pdf",
    fileHash: null,
    id: "asset-grm188-datasheet",
    licenseMode: "metadata_only",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-grm188r71c104ka01d",
    previewStatus: "not_available",
    providerId: "seed:datasheet-metadata",
    sourceRecordId: "source-seed-grm188",
    sourceUrl: "https://www.murata.com/en-us/products/productdetail?partno=GRM188R71C104KA01D",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetType: "datasheet",
    assetState: "referenced",
    fileFormat: "pdf",
    fileHash: null,
    id: "asset-stm32g031-datasheet",
    licenseMode: "metadata_only",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-stm32g031k8t6",
    previewStatus: "not_available",
    providerId: "seed:datasheet-metadata",
    sourceRecordId: "source-seed-stm32g031",
    sourceUrl: "https://www.st.com/resource/en/datasheet/stm32g031k8.pdf",
    storageKey: null,
    validationStatus: "needs_review"
  },
  {
    assetType: "three_d_model",
    assetState: "missing",
    fileFormat: "unknown",
    fileHash: null,
    id: "asset-stm32g031-3d",
    licenseMode: "unknown",
    lastUpdatedAt: LAST_UPDATED_AT,
    partId: "part-stm32g031k8t6",
    previewStatus: "not_available",
    providerId: "seed:cad-metadata",
    sourceRecordId: "source-seed-stm32g031",
    sourceUrl: null,
    storageKey: null,
    validationStatus: "not_validated"
  }
] satisfies Asset[];
