/**
 * File header: Defines the shared EE Library domain types from docs/DATA_MODEL.md.
 */

/** Lifecycle values keep lifecycle uncertainty explicit instead of hiding it in strings. */
export type LifecycleStatus = "active" | "not_recommended" | "obsolete" | "unknown";

/** Normalized units follow the unit policy from docs/DATA_MODEL.md. */
export type MetricUnit = "V" | "A" | "F" | "H" | "ohm" | "mm" | "Hz" | "deg C";

/** Asset kinds match the MVP asset registry without naming a specific provider. */
export type AssetType = "datasheet" | "footprint" | "symbol" | "three_d_model";

/** File formats describe storage content without implying availability. */
export type FileFormat = "pdf" | "step" | "kicad_mod" | "kicad_sym" | "unknown";

/** License modes prevent the UI from promising redistribution when it is not known. */
export type LicenseMode = "metadata_only" | "redistribution_allowed" | "unknown";

/** Validation status describes trust in the asset or metadata. */
export type ValidationStatus = "verified" | "needs_review" | "not_validated" | "failed";

/** Preview status describes whether a visual preview can be rendered. */
export type PreviewStatus = "ready" | "pending" | "not_available";

/** AssetState tracks the concrete file lifecycle without implying fake availability. */
export type AssetState = "missing" | "referenced" | "downloaded" | "validated" | "failed";

/** Manufacturer is the normalized maker entity used by search and detail pages. */
export interface Manufacturer {
  /** Stable identifier used by internal records. */
  id: string;
  /** Official or display-ready manufacturer name. */
  name: string;
  /** Search aliases that should never replace the official name. */
  aliases: string[];
  /** Public manufacturer website when known. */
  website: string | null;
}

/** Package is the normalized physical package entity from the data model. */
export interface Package {
  /** Stable package identifier used by part records. */
  id: string;
  /** Display-ready package name such as SOT-23-5 or 0603. */
  packageName: string;
  /** Pin or terminal count when the package exposes one. */
  pinCount: number | null;
  /** Normalized terminal pitch in millimeters. */
  pitchMm: number | null;
  /** Normalized body length in millimeters. */
  bodyLengthMm: number | null;
  /** Normalized body width in millimeters. */
  bodyWidthMm: number | null;
  /** Normalized body height in millimeters. */
  bodyHeightMm: number | null;
}

/** Part is the normalized catalog entity that search results are built around. */
export interface Part {
  /** Stable part identifier used across the monorepo. */
  id: string;
  /** Manufacturer part number displayed as the primary engineering identifier. */
  mpn: string;
  /** Foreign key back to the normalized manufacturer. */
  manufacturerId: string;
  /** Coarse engineering category used by filters. */
  category: string;
  /** Lifecycle state with unknown kept distinct from active. */
  lifecycleStatus: LifecycleStatus;
  /** Foreign key back to the normalized package record. */
  packageId: string;
  /** Normalized trust score from 0 to 1. */
  trustScore: number;
  /** ISO timestamp for the latest canonical record update. */
  lastUpdatedAt: string;
}

/** SourceRecord preserves raw provider payload provenance for normalized records. */
export interface SourceRecord {
  /** Stable source record identifier. */
  id: string;
  /** Opaque provider identifier. */
  providerId: string;
  /** Provider-specific part key used for deterministic upserts. */
  providerPartKey: string;
  /** Canonical part identifier when the payload has been normalized. */
  partId: string | null;
  /** Provider source URL when one exists. */
  sourceUrl: string | null;
  /** ISO timestamp for when the raw payload was fetched. */
  fetchedAt: string;
  /** Raw provider payload retained for provenance and later audits. */
  rawPayload: unknown;
  /** ISO timestamp for when this payload was normalized. */
  normalizedAt: string | null;
  /** ISO timestamp for the latest source record update. */
  lastUpdatedAt: string;
}

/** PartMetric stores one normalized datasheet metric with confidence and provenance. */
export interface PartMetric {
  /** Stable metric identifier. */
  id: string;
  /** Foreign key back to the part this metric describes. */
  partId: string;
  /** Machine-readable metric name such as input_voltage_max. */
  metricKey: string;
  /** Single normalized value when the datasheet gives one. */
  metricValue: number | null;
  /** Normalized unit for the value or range. */
  unit: MetricUnit;
  /** Lower bound when the metric is a range. */
  minValue: number | null;
  /** Upper bound when the metric is a range. */
  maxValue: number | null;
  /** Confidence score from 0 to 1 for this normalized metric. */
  confidenceScore: number;
  /** Datasheet revision that supplied or validated this metric. */
  sourceRevisionId: string;
  /** Source record that supplied the metric normalization. */
  sourceRecordId: string | null;
  /** ISO timestamp for the latest metric update. */
  lastUpdatedAt: string;
}

/** Asset tracks metadata, storage, validation, preview, and source provenance for files. */
export interface Asset {
  /** Stable asset identifier. */
  id: string;
  /** Foreign key back to the part this asset belongs to. */
  partId: string;
  /** Provider-neutral asset category. */
  assetType: AssetType;
  /** Provider-neutral file format. */
  fileFormat: FileFormat;
  /** Storage key when a real file exists, otherwise null for metadata-only records. */
  storageKey: string | null;
  /** Content hash when a real file has been captured and hashed. */
  fileHash: string | null;
  /** Opaque provider or source identifier used only for provenance. */
  providerId: string | null;
  /** Redistribution status for the asset. */
  licenseMode: LicenseMode;
  /** Validation state for the asset metadata or file. */
  validationStatus: ValidationStatus;
  /** Preview readiness for UI rendering. */
  previewStatus: PreviewStatus;
  /** Concrete asset file lifecycle state. */
  assetState: AssetState;
  /** Provider source URL for a referenced asset when known. */
  sourceUrl: string | null;
  /** Source record that supplied the asset metadata. */
  sourceRecordId: string | null;
  /** ISO timestamp for the latest asset update. */
  lastUpdatedAt: string;
}

/** DatasheetRevision stores parsed datasheet revision metadata and parse confidence. */
export interface DatasheetRevision {
  /** Stable datasheet revision identifier. */
  id: string;
  /** Foreign key back to the part this datasheet describes. */
  partId: string;
  /** Human-readable revision label from the datasheet. */
  revisionLabel: string;
  /** ISO date string when the revision date is known. */
  revisionDate: string | null;
  /** Page count when it has been parsed or verified. */
  pageCount: number | null;
  /** Linked asset identifier for the PDF metadata or file. */
  fileAssetId: string | null;
  /** Confidence score from 0 to 1 for the parsed datasheet revision. */
  parseConfidence: number;
  /** Source record that supplied the datasheet revision. */
  sourceRecordId: string | null;
  /** ISO timestamp for the latest datasheet revision update. */
  lastUpdatedAt: string;
}

/** CAD availability filters let search distinguish exportable records from unavailable ones. */
export type CadAvailabilityFilter = "any" | "available" | "unavailable";

/** PartSearchFilters contains provider-neutral filters used by web and API. */
export interface PartSearchFilters {
  /** Free-text query matching MPN, manufacturer, aliases, package, or category. */
  query?: string | undefined;
  /** Optional manufacturer identifier filter. */
  manufacturerId?: string | undefined;
  /** Optional category filter. */
  category?: string | undefined;
  /** Optional package identifier filter. */
  packageId?: string | undefined;
  /** Optional lifecycle status filter. */
  lifecycleStatus?: LifecycleStatus | undefined;
  /** Optional CAD file availability filter. */
  cadAvailability?: CadAvailabilityFilter | undefined;
}

/** PartSearchRecord is the joined record shape consumed by API and web search. */
export interface PartSearchRecord {
  /** Normalized part row. */
  part: Part;
  /** Joined manufacturer row. */
  manufacturer: Manufacturer;
  /** Joined package row. */
  package: Package;
  /** Metrics linked to the part. */
  metrics: PartMetric[];
  /** Assets linked to the part. */
  assets: Asset[];
  /** Latest datasheet revision when one is known. */
  datasheetRevision: DatasheetRevision | null;
  /** Source records that contributed to this canonical part. */
  sources: SourceRecord[];
  /** ISO timestamp for the latest joined record update. */
  lastUpdatedAt: string;
}

/** SearchFacets contains provider-neutral filter data served by the API. */
export interface SearchFacets {
  /** Manufacturers available to the search filter rail. */
  manufacturers: Manufacturer[];
  /** Categories available to the search filter rail. */
  categories: string[];
  /** Packages available to the search filter rail. */
  packages: Package[];
  /** Lifecycle states available to the search filter rail. */
  lifecycleStatuses: LifecycleStatus[];
}

/** ExportAvailability records whether a bundle can be created from real files. */
export interface ExportAvailability {
  /** Stable export target identifier. */
  id: "altium" | "solidworks" | "neutral_cad";
  /** User-facing target name. */
  label: string;
  /** True only when required validated downloadable assets exist. */
  available: boolean;
  /** Human-readable availability reason for disabled actions or audit text. */
  reason: string;
}

/** CatalogDataSource names the backing source used by an API response. */
export type CatalogDataSource = "database" | "seed_fallback";

/** ApiEnvelope defines the typed JSON response envelope used by apps/api. */
export interface ApiEnvelope<TData> {
  /** Response data returned by the API service. */
  data: TData;
  /** Backing catalog source when the route serves catalog data. */
  source?: CatalogDataSource;
}
