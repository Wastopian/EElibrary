/**
 * File header: Demo catalog rows used by seed:parts. Mirrors packages/shared/src/seed.ts so the
 * setup-dev script does not depend on TypeScript loaders. Keep in sync with the shared module.
 */

export const LAST_UPDATED_AT = "2026-04-12T00:00:00.000Z";

export const manufacturers = [
  { id: "mfr-texas-instruments", name: "Texas Instruments", aliases: ["TI"], website: "https://www.ti.com" },
  { id: "mfr-murata", name: "Murata", aliases: ["Murata Manufacturing"], website: "https://www.murata.com" },
  { id: "mfr-stmicroelectronics", name: "STMicroelectronics", aliases: ["ST"], website: "https://www.st.com" }
];

export const partPackages = [
  {
    id: "pkg-sot-23-5",
    packageName: "SOT-23-5",
    pinCount: 5,
    pitchMm: 0.95,
    bodyLengthMm: 2.9,
    bodyWidthMm: 1.6,
    bodyHeightMm: 1.45
  },
  {
    id: "pkg-0603",
    packageName: "0603",
    pinCount: 2,
    pitchMm: null,
    bodyLengthMm: 1.6,
    bodyWidthMm: 0.8,
    bodyHeightMm: 0.8
  },
  {
    id: "pkg-qfn-32",
    packageName: "QFN-32",
    pinCount: 32,
    pitchMm: 0.5,
    bodyLengthMm: 5,
    bodyWidthMm: 5,
    bodyHeightMm: 0.6
  }
];

export const parts = [
  {
    id: "part-tps7a02dbvr",
    mpn: "TPS7A02DBVR",
    manufacturerId: "mfr-texas-instruments",
    category: "Power management",
    lifecycleStatus: "active",
    packageId: "pkg-sot-23-5",
    trustScore: 0.82
  },
  {
    id: "part-grm188r71c104ka01d",
    mpn: "GRM188R71C104KA01D",
    manufacturerId: "mfr-murata",
    category: "Capacitor",
    lifecycleStatus: "active",
    packageId: "pkg-0603",
    trustScore: 0.74
  },
  {
    id: "part-stm32g031k8t6",
    mpn: "STM32G031K8T6",
    manufacturerId: "mfr-stmicroelectronics",
    category: "Microcontroller",
    lifecycleStatus: "active",
    packageId: "pkg-qfn-32",
    trustScore: 0.68
  }
];

export const sourceRecords = [
  {
    id: "source-seed-tps7a02",
    providerId: "seed:local-catalog",
    providerPartKey: "TPS7A02DBVR",
    partId: "part-tps7a02dbvr",
    sourceUrl: "https://www.ti.com/product/TPS7A02",
    rawPayload: { mpn: "TPS7A02DBVR" }
  },
  {
    id: "source-seed-grm188",
    providerId: "seed:local-catalog",
    providerPartKey: "GRM188R71C104KA01D",
    partId: "part-grm188r71c104ka01d",
    sourceUrl: "https://www.murata.com/en-us/products/productdetail?partno=GRM188R71C104KA01D",
    rawPayload: { mpn: "GRM188R71C104KA01D" }
  },
  {
    id: "source-seed-stm32g031",
    providerId: "seed:local-catalog",
    providerPartKey: "STM32G031K8T6",
    partId: "part-stm32g031k8t6",
    sourceUrl: "https://www.st.com/en/microcontrollers-microprocessors/stm32g031k8.html",
    rawPayload: { mpn: "STM32G031K8T6" }
  }
];

export const datasheetRevisions = [
  {
    id: "dsr-tps7a02-rev-e",
    partId: "part-tps7a02dbvr",
    revisionLabel: "Rev. E",
    revisionDate: "2024-02-01",
    pageCount: 39,
    fileAssetId: "asset-tps7a02-datasheet",
    parseConfidence: 0.79,
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    id: "dsr-grm188-series",
    partId: "part-grm188r71c104ka01d",
    revisionLabel: "Series data",
    revisionDate: "2023-11-15",
    pageCount: 12,
    fileAssetId: "asset-grm188-datasheet",
    parseConfidence: 0.72,
    sourceRecordId: "source-seed-grm188"
  },
  {
    id: "dsr-stm32g031-rev-7",
    partId: "part-stm32g031k8t6",
    revisionLabel: "Rev. 7",
    revisionDate: "2024-06-20",
    pageCount: 123,
    fileAssetId: "asset-stm32g031-datasheet",
    parseConfidence: 0.66,
    sourceRecordId: "source-seed-stm32g031"
  }
];

export const partMetrics = [
  {
    id: "metric-tps7a02-input-voltage-max",
    partId: "part-tps7a02dbvr",
    metricKey: "input_voltage_max",
    metricValue: 5.5,
    unit: "V",
    minValue: null,
    maxValue: null,
    confidenceScore: 0.83,
    sourceRevisionId: "dsr-tps7a02-rev-e",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    id: "metric-tps7a02-output-current-max",
    partId: "part-tps7a02dbvr",
    metricKey: "output_current_max",
    metricValue: 0.2,
    unit: "A",
    minValue: null,
    maxValue: null,
    confidenceScore: 0.81,
    sourceRevisionId: "dsr-tps7a02-rev-e",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    id: "metric-grm188-capacitance",
    partId: "part-grm188r71c104ka01d",
    metricKey: "capacitance",
    metricValue: 0.0000001,
    unit: "F",
    minValue: null,
    maxValue: null,
    confidenceScore: 0.76,
    sourceRevisionId: "dsr-grm188-series",
    sourceRecordId: "source-seed-grm188"
  },
  {
    id: "metric-grm188-rated-voltage",
    partId: "part-grm188r71c104ka01d",
    metricKey: "rated_voltage",
    metricValue: 16,
    unit: "V",
    minValue: null,
    maxValue: null,
    confidenceScore: 0.74,
    sourceRevisionId: "dsr-grm188-series",
    sourceRecordId: "source-seed-grm188"
  },
  {
    id: "metric-stm32g031-supply-voltage",
    partId: "part-stm32g031k8t6",
    metricKey: "supply_voltage",
    metricValue: null,
    unit: "V",
    minValue: 2,
    maxValue: 3.6,
    confidenceScore: 0.71,
    sourceRevisionId: "dsr-stm32g031-rev-7",
    sourceRecordId: "source-seed-stm32g031"
  },
  {
    id: "metric-stm32g031-clock-frequency-max",
    partId: "part-stm32g031k8t6",
    metricKey: "clock_frequency_max",
    metricValue: 64000000,
    unit: "Hz",
    minValue: null,
    maxValue: null,
    confidenceScore: 0.67,
    sourceRevisionId: "dsr-stm32g031-rev-7",
    sourceRecordId: "source-seed-stm32g031"
  }
];

export const assets = [
  {
    id: "asset-tps7a02-datasheet",
    partId: "part-tps7a02dbvr",
    assetType: "datasheet",
    fileFormat: "pdf",
    storageKey: null,
    fileHash: null,
    providerId: "seed:datasheet-metadata",
    licenseMode: "metadata_only",
    validationStatus: "needs_review",
    previewStatus: "not_available",
    assetState: "referenced",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    id: "asset-tps7a02-footprint",
    partId: "part-tps7a02dbvr",
    assetType: "footprint",
    fileFormat: "unknown",
    storageKey: null,
    fileHash: null,
    providerId: "seed:cad-metadata",
    licenseMode: "unknown",
    validationStatus: "not_validated",
    previewStatus: "not_available",
    assetState: "missing",
    sourceUrl: null,
    sourceRecordId: "source-seed-tps7a02"
  },
  {
    id: "asset-grm188-datasheet",
    partId: "part-grm188r71c104ka01d",
    assetType: "datasheet",
    fileFormat: "pdf",
    storageKey: null,
    fileHash: null,
    providerId: "seed:datasheet-metadata",
    licenseMode: "metadata_only",
    validationStatus: "needs_review",
    previewStatus: "not_available",
    assetState: "referenced",
    sourceUrl: "https://www.murata.com/en-us/products/productdetail?partno=GRM188R71C104KA01D",
    sourceRecordId: "source-seed-grm188"
  },
  {
    id: "asset-stm32g031-datasheet",
    partId: "part-stm32g031k8t6",
    assetType: "datasheet",
    fileFormat: "pdf",
    storageKey: null,
    fileHash: null,
    providerId: "seed:datasheet-metadata",
    licenseMode: "metadata_only",
    validationStatus: "needs_review",
    previewStatus: "not_available",
    assetState: "referenced",
    sourceUrl: "https://www.st.com/resource/en/datasheet/stm32g031k8.pdf",
    sourceRecordId: "source-seed-stm32g031"
  },
  {
    id: "asset-stm32g031-3d",
    partId: "part-stm32g031k8t6",
    assetType: "three_d_model",
    fileFormat: "unknown",
    storageKey: null,
    fileHash: null,
    providerId: "seed:cad-metadata",
    licenseMode: "unknown",
    validationStatus: "not_validated",
    previewStatus: "not_available",
    assetState: "missing",
    sourceUrl: null,
    sourceRecordId: "source-seed-stm32g031"
  }
];
