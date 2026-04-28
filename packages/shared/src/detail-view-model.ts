/**
 * File header: Builds the engineer-first part detail view model from a PartSearchRecord.
 * Lives in @ee-library/shared so it can be tested without React. The web app maps the
 * resulting Tone union to its UI BadgeTone (same string values).
 */

import { isFileBackedAsset, isValidatedDownloadableAsset } from "./asset-state";
import { getExportAvailability, formatMetricLabel, formatMetricValue } from "./search";
import type {
  Asset,
  AssetState,
  AssetType,
  ExportAvailability,
  FileFormat,
  LifecycleStatus,
  Package,
  PartSearchRecord,
  PreviewStatus,
  ValidationStatus
} from "./types";

/** Tone is the small, provider-neutral palette the UI badge component understands. */
export type Tone = "neutral" | "info" | "verified" | "review" | "danger";

/** PartDetailIdentity is the identity-first banner data used at the top of the page. */
export interface PartDetailIdentity {
  /** Manufacturer part number, treated as the primary engineering identifier. */
  mpn: string;
  /** Display-ready manufacturer name. */
  manufacturerName: string;
  /** Short description synthesized from category + package until a real description field exists. */
  description: string;
  /** Coarse engineering category. */
  category: string;
  /** Display-ready package name. */
  packageName: string;
  /** Raw lifecycle status for filtering/comparison. */
  lifecycleStatus: LifecycleStatus;
  /** Human-readable lifecycle label. */
  lifecycleLabel: string;
  /** Tone the UI should use for the lifecycle badge. */
  lifecycleTone: Tone;
  /** Normalized trust score from 0..1. */
  trustScore: number;
  /** Tone the UI should use for the trust score badge. */
  trustTone: Tone;
  /** ISO timestamp for the latest record update. */
  lastUpdatedAt: string;
  /** Number of source records contributing to this canonical part. */
  sourceCount: number;
}

/** PartDetailMetricRow describes one row in the engineer-summary key-specs table. */
export interface PartDetailMetricRow {
  /** Stable metric key for keys/diffing. */
  key: string;
  /** Human-readable label such as "Input Voltage Max". */
  label: string;
  /** Pre-formatted value with units. */
  value: string;
  /** Rounded confidence percentage (0..100) for the source datasheet revision. */
  confidencePercent: number;
  /** Tone matching the confidence bucket. */
  confidenceTone: Tone;
}

/** PartDetailDatasheet describes the datasheet block including the open/download action. */
export interface PartDetailDatasheet {
  /** True when at least a referenced URL or stored file exists. */
  available: boolean;
  /** Revision label such as "Rev. E" or "No revision". */
  revisionLabel: string;
  /** Revision date if known. */
  revisionDate: string | null;
  /** Page count when the datasheet was parsed. */
  pageCount: number | null;
  /** Parse confidence percent for the datasheet revision (0..100). */
  parseConfidencePercent: number;
  /** Tone for the parse confidence badge. */
  parseConfidenceTone: Tone;
  /** True when a captured file exists in storage. */
  fileBacked: boolean;
  /** Tone for the storage-evidence badge. */
  fileBackedTone: Tone;
  /** Action label such as "Download datasheet" / "Open referenced URL" / "No datasheet". */
  actionLabel: string;
  /** Action target URL when one exists. */
  actionUrl: string | null;
  /** True when the action target is reachable (storage-backed or referenced). */
  actionEnabled: boolean;
  /** True when the action would download a captured file vs open an external URL. */
  actionOpensExternal: boolean;
}

/** PartDetailCadAsset is the per-CAD-asset readiness row. */
export interface PartDetailCadAsset {
  /** CAD asset type this row covers. */
  assetType: AssetType;
  /** Display-ready label such as "Footprint" / "Symbol" / "3D model". */
  label: string;
  /** Whether the catalog has any record for this asset type. */
  present: boolean;
  /** Concrete asset state. "missing" when no row exists at all. */
  state: AssetState;
  /** Display-ready state copy. */
  stateLabel: string;
  /** Tone for the state badge. */
  stateTone: Tone;
  /** Display-ready validation copy. */
  validationLabel: string;
  /** Tone for the validation badge. */
  validationTone: Tone;
  /** Provider-neutral file format. */
  fileFormat: FileFormat;
  /** True when the asset is validated, downloadable, and exportable. */
  exportable: boolean;
  /** Source URL when the asset is referenced. */
  sourceUrl: string | null;
}

/** PartDetailCadReadiness rolls up CAD readiness for the engineer-summary panel. */
export interface PartDetailCadReadiness {
  /** Symbol asset readiness. */
  symbol: PartDetailCadAsset;
  /** Footprint asset readiness. */
  footprint: PartDetailCadAsset;
  /** 3D model asset readiness. */
  threeDModel: PartDetailCadAsset;
  /** True when ALL three asset types are exportable. */
  allExportable: boolean;
  /** Number of CAD asset types that are exportable (0..3). */
  exportableCount: number;
}

/** PartDetailIssueCode is the closed set of issues the detail page surfaces. */
export type PartDetailIssueCode =
  | "missing_datasheet"
  | "datasheet_not_downloaded"
  | "missing_symbol"
  | "missing_footprint"
  | "missing_three_d_model"
  | "asset_validation_failed"
  | "low_trust_score"
  | "lifecycle_risk";

/** PartDetailNextAction describes the recommended follow-up for an issue. */
export interface PartDetailNextAction {
  /** Display-ready button or link copy. */
  label: string;
  /** Action kind; controls how the UI renders the action. */
  kind: "link" | "command";
  /** External or internal URL when kind === "link". */
  href?: string;
  /** Shell command to run when kind === "command". */
  command?: string;
}

/** PartDetailIssue surfaces a missing-data problem with an actionable next step. */
export interface PartDetailIssue {
  /** Stable issue code for tests and admin queues. */
  code: PartDetailIssueCode;
  /** Short user-facing headline. */
  headline: string;
  /** Detail copy explaining the issue. */
  body: string;
  /** Tone for the issue chip. */
  tone: Tone;
  /** Next-action recommendation, or null when the issue is informational only. */
  next: PartDetailNextAction | null;
}

/** PartDetailProvenanceRow surfaces one source record in compact form. */
export interface PartDetailProvenanceRow {
  /** Source record identifier. */
  id: string;
  /** Provider id this record came from. */
  providerId: string;
  /** Provider-specific lookup key. */
  providerPartKey: string;
  /** Source URL when known. */
  sourceUrl: string | null;
  /** ISO timestamp the payload was fetched. */
  fetchedAt: string;
  /** ISO timestamp the payload was normalized. */
  normalizedAt: string | null;
}

/** PartDetailViewModel is what the detail page renders. */
export interface PartDetailViewModel {
  identity: PartDetailIdentity;
  metrics: PartDetailMetricRow[];
  datasheet: PartDetailDatasheet;
  cadReadiness: PartDetailCadReadiness;
  issues: PartDetailIssue[];
  exportActions: ExportAvailability[];
  provenance: PartDetailProvenanceRow[];
  /** Asset list preserved for the secondary "Raw assets" section. */
  rawAssets: Asset[];
  /** Package dimensions block kept for the existing dimension grid. */
  partPackage: Package;
  /** True when the part already has every CAD asset validated and a downloadable datasheet. */
  fullyReady: boolean;
}

/** TOP_METRIC_LIMIT caps the engineer summary table at a scannable size. */
const TOP_METRIC_LIMIT = 6;

/** TRUST_SCORE_LOW_THRESHOLD is the line below which we surface a low_trust_score issue. */
const TRUST_SCORE_LOW_THRESHOLD = 0.65;

/**
 * Builds the engineer-first view model from a joined PartSearchRecord.
 */
export function buildPartDetailViewModel(record: PartSearchRecord): PartDetailViewModel {
  const identity = buildIdentity(record);
  const metrics = buildMetrics(record);
  const datasheet = buildDatasheet(record);
  const cadReadiness = buildCadReadiness(record);
  const issues = buildIssues(record, identity, datasheet, cadReadiness);
  const exportActions = getExportAvailability(record);
  const provenance = record.sources.map(toProvenanceRow);
  const fullyReady = cadReadiness.allExportable && datasheet.actionEnabled && datasheet.fileBacked;

  return {
    cadReadiness,
    datasheet,
    exportActions,
    fullyReady,
    identity,
    issues,
    metrics,
    partPackage: record.package,
    provenance,
    rawAssets: record.assets
  };
}

/**
 * Maps a numeric score to a coarse Tone bucket.
 */
export function scoreTone(score: number): Tone {
  if (score >= 0.8) {
    return "verified";
  }
  if (score >= TRUST_SCORE_LOW_THRESHOLD) {
    return "review";
  }
  return "danger";
}

/**
 * Maps an asset state to the UI tone used by the detail page.
 */
export function assetStateTone(state: AssetState): Tone {
  const tones: Record<AssetState, Tone> = {
    downloaded: "review",
    failed: "danger",
    missing: "neutral",
    referenced: "review",
    validated: "verified"
  };
  return tones[state];
}

/**
 * Maps a validation status to the UI tone used by the detail page.
 */
export function validationTone(status: ValidationStatus): Tone {
  const tones: Record<ValidationStatus, Tone> = {
    failed: "danger",
    needs_review: "review",
    not_validated: "neutral",
    verified: "verified"
  };
  return tones[status];
}

/**
 * Maps preview status to the UI tone.
 */
export function previewTone(status: PreviewStatus): Tone {
  const tones: Record<PreviewStatus, Tone> = {
    not_available: "neutral",
    pending: "review",
    ready: "verified"
  };
  return tones[status];
}

/**
 * Maps an asset state to short display copy.
 */
export function assetStateLabel(state: AssetState): string {
  const labels: Record<AssetState, string> = {
    downloaded: "Downloaded",
    failed: "Failed",
    missing: "Missing",
    referenced: "Referenced",
    validated: "Validated"
  };
  return labels[state];
}

/**
 * Maps a validation status to short display copy.
 */
export function validationLabel(status: ValidationStatus): string {
  const labels: Record<ValidationStatus, string> = {
    failed: "Validation failed",
    needs_review: "Needs review",
    not_validated: "Not validated",
    verified: "Verified"
  };
  return labels[status];
}

/**
 * Maps preview status to short display copy.
 */
export function previewLabel(status: PreviewStatus): string {
  const labels: Record<PreviewStatus, string> = {
    not_available: "No preview",
    pending: "Preview pending",
    ready: "Preview ready"
  };
  return labels[status];
}

/**
 * Maps an asset type to its display-ready section label.
 */
export function assetTypeLabel(assetType: AssetType): string {
  const labels: Record<AssetType, string> = {
    datasheet: "Datasheet",
    footprint: "Footprint",
    symbol: "Symbol",
    three_d_model: "3D model"
  };
  return labels[assetType];
}

/**
 * Builds the identity summary block.
 */
function buildIdentity(record: PartSearchRecord): PartDetailIdentity {
  return {
    category: record.part.category,
    description: synthesizeDescription(record),
    lastUpdatedAt: record.lastUpdatedAt,
    lifecycleLabel: lifecycleLabel(record.part.lifecycleStatus),
    lifecycleStatus: record.part.lifecycleStatus,
    lifecycleTone: lifecycleTone(record.part.lifecycleStatus),
    manufacturerName: record.manufacturer.name,
    mpn: record.part.mpn,
    packageName: record.package.packageName,
    sourceCount: record.sources.length,
    trustScore: record.part.trustScore,
    trustTone: scoreTone(record.part.trustScore)
  };
}

/**
 * Synthesizes a short engineer-readable description until a real description field exists.
 * TODO: replace with a normalized `parts.description` column once provider adapters expose one.
 */
function synthesizeDescription(record: PartSearchRecord): string {
  const segments = [record.part.category, record.package.packageName, record.manufacturer.name].filter(Boolean);
  return segments.join(" / ");
}

/**
 * Returns a human-readable lifecycle label.
 */
function lifecycleLabel(status: LifecycleStatus): string {
  const labels: Record<LifecycleStatus, string> = {
    active: "Active",
    not_recommended: "Not recommended",
    obsolete: "Obsolete",
    unknown: "Lifecycle unknown"
  };
  return labels[status];
}

/**
 * Returns a tone for the lifecycle badge that matches engineering risk.
 */
function lifecycleTone(status: LifecycleStatus): Tone {
  const tones: Record<LifecycleStatus, Tone> = {
    active: "verified",
    not_recommended: "review",
    obsolete: "danger",
    unknown: "neutral"
  };
  return tones[status];
}

/**
 * Builds the engineer-summary key-specs table, capped at TOP_METRIC_LIMIT entries
 * and sorted with the highest-confidence metrics first.
 */
function buildMetrics(record: PartSearchRecord): PartDetailMetricRow[] {
  return [...record.metrics]
    .sort((first, second) => second.confidenceScore - first.confidenceScore)
    .slice(0, TOP_METRIC_LIMIT)
    .map((metric) => ({
      confidencePercent: Math.round(metric.confidenceScore * 100),
      confidenceTone: scoreTone(metric.confidenceScore),
      key: metric.id,
      label: formatMetricLabel(metric.metricKey),
      value: formatMetricValue(metric)
    }));
}

/**
 * Builds the datasheet block including the recommended action.
 */
function buildDatasheet(record: PartSearchRecord): PartDetailDatasheet {
  const datasheet = record.datasheetRevision;
  const datasheetByFileAssetId = datasheet?.fileAssetId
    ? record.assets.find((asset) => asset.id === datasheet.fileAssetId)
    : undefined;
  const datasheetAsset = datasheetByFileAssetId ?? record.assets.find((asset) => asset.assetType === "datasheet");

  const fileBacked = datasheetAsset ? isFileBackedAsset(datasheetAsset) : false;
  const referencedUrl = datasheetAsset?.sourceUrl ?? null;
  const parseConfidence = datasheet?.parseConfidence ?? 0;
  const parseConfidencePercent = Math.round(parseConfidence * 100);

  let actionLabel: string;
  let actionUrl: string | null;
  let actionOpensExternal: boolean;

  if (fileBacked && datasheetAsset?.storageKey) {
    actionLabel = "Download datasheet";
    actionUrl = `/storage/${encodeURIComponent(datasheetAsset.storageKey)}`;
    actionOpensExternal = false;
  } else if (referencedUrl) {
    actionLabel = "Open referenced URL";
    actionUrl = referencedUrl;
    actionOpensExternal = true;
  } else {
    actionLabel = "No datasheet";
    actionUrl = null;
    actionOpensExternal = false;
  }

  return {
    actionEnabled: actionUrl !== null,
    actionLabel,
    actionOpensExternal,
    actionUrl,
    available: datasheet !== null && datasheet !== undefined,
    fileBacked,
    fileBackedTone: fileBacked ? "verified" : referencedUrl ? "review" : "neutral",
    pageCount: datasheet?.pageCount ?? null,
    parseConfidencePercent,
    parseConfidenceTone: scoreTone(parseConfidence),
    revisionDate: datasheet?.revisionDate ?? null,
    revisionLabel: datasheet?.revisionLabel ?? "No revision recorded"
  };
}

/**
 * Builds the CAD readiness summary covering symbol, footprint, and 3D model.
 */
function buildCadReadiness(record: PartSearchRecord): PartDetailCadReadiness {
  const symbol = buildCadAssetSummary(record, "symbol");
  const footprint = buildCadAssetSummary(record, "footprint");
  const threeDModel = buildCadAssetSummary(record, "three_d_model");

  const exportableCount = [symbol, footprint, threeDModel].filter((entry) => entry.exportable).length;

  return {
    allExportable: exportableCount === 3,
    exportableCount,
    footprint,
    symbol,
    threeDModel
  };
}

/**
 * Builds one CAD asset readiness summary, synthesizing a "missing" placeholder when no
 * asset row exists for the given type.
 */
function buildCadAssetSummary(record: PartSearchRecord, assetType: AssetType): PartDetailCadAsset {
  const asset = record.assets.find((candidate) => candidate.assetType === assetType);

  if (!asset) {
    return {
      assetType,
      exportable: false,
      fileFormat: "unknown",
      label: assetTypeLabel(assetType),
      present: false,
      sourceUrl: null,
      state: "missing",
      stateLabel: assetStateLabel("missing"),
      stateTone: assetStateTone("missing"),
      validationLabel: validationLabel("not_validated"),
      validationTone: validationTone("not_validated")
    };
  }

  return {
    assetType: asset.assetType,
    exportable: isValidatedDownloadableAsset(asset),
    fileFormat: asset.fileFormat,
    label: assetTypeLabel(asset.assetType),
    present: true,
    sourceUrl: asset.sourceUrl,
    state: asset.assetState,
    stateLabel: assetStateLabel(asset.assetState),
    stateTone: assetStateTone(asset.assetState),
    validationLabel: validationLabel(asset.validationStatus),
    validationTone: validationTone(asset.validationStatus)
  };
}

/**
 * Builds the prioritized issue list for the detail page.
 * Order matters; the page renders them top-to-bottom.
 */
function buildIssues(record: PartSearchRecord, identity: PartDetailIdentity, datasheet: PartDetailDatasheet, cadReadiness: PartDetailCadReadiness): PartDetailIssue[] {
  const issues: PartDetailIssue[] = [];

  if (!datasheet.available) {
    issues.push({
      body: "No datasheet revision was captured for this part. Re-import or trigger datasheet enrichment to attach one.",
      code: "missing_datasheet",
      headline: "Datasheet missing",
      next: { command: "npm run dev:worker", kind: "command", label: "Run worker to enrich datasheet" },
      tone: "danger"
    });
  } else if (datasheet.available && !datasheet.fileBacked) {
    issues.push({
      body: "A datasheet URL is on file but the PDF has not been downloaded or hashed locally yet.",
      code: "datasheet_not_downloaded",
      headline: "Datasheet referenced only",
      next: datasheet.actionUrl
        ? { href: datasheet.actionUrl, kind: "link", label: "Open referenced datasheet" }
        : { command: "npm run dev:worker", kind: "command", label: "Run worker to download datasheet" },
      tone: "review"
    });
  }

  if (!cadReadiness.symbol.exportable) {
    issues.push(buildMissingCadIssue("missing_symbol", cadReadiness.symbol, "Symbol missing"));
  }
  if (!cadReadiness.footprint.exportable) {
    issues.push(buildMissingCadIssue("missing_footprint", cadReadiness.footprint, "Footprint missing"));
  }
  if (!cadReadiness.threeDModel.exportable) {
    issues.push(buildMissingCadIssue("missing_three_d_model", cadReadiness.threeDModel, "3D model missing"));
  }

  const hasFailedAsset = record.assets.some((asset) => asset.assetState === "failed" || asset.validationStatus === "failed");
  if (hasFailedAsset) {
    issues.push({
      body: "One or more captured asset files failed validation. Re-running ingestion or generation should clear this.",
      code: "asset_validation_failed",
      headline: "Asset validation failed",
      next: { command: "npm run ingest:local", kind: "command", label: "Re-run local ingestion" },
      tone: "danger"
    });
  }

  if (record.part.lifecycleStatus !== "active") {
    issues.push({
      body: `Lifecycle is ${identity.lifecycleLabel.toLowerCase()}. Plan replacements or confirm long-term availability before designing in.`,
      code: "lifecycle_risk",
      headline: "Lifecycle risk",
      next: null,
      tone: identity.lifecycleTone
    });
  }

  if (record.part.trustScore < TRUST_SCORE_LOW_THRESHOLD) {
    issues.push({
      body: "Trust score is low. Confirm normalized fields against the source datasheet before relying on the data for production.",
      code: "low_trust_score",
      headline: "Low trust score",
      next: null,
      tone: "review"
    });
  }

  return issues;
}

/**
 * Builds a CAD-asset missing issue with the right next-action.
 */
function buildMissingCadIssue(code: PartDetailIssueCode, summary: PartDetailCadAsset, headline: string): PartDetailIssue {
  if (!summary.present) {
    return {
      body: `No ${summary.label.toLowerCase()} asset record exists. Trigger ingestion or generation to attach one.`,
      code,
      headline,
      next: { command: "npm run dev:worker", kind: "command", label: `Run worker to fetch ${summary.label.toLowerCase()}` },
      tone: "danger"
    };
  }

  if (summary.state === "referenced" && summary.sourceUrl) {
    return {
      body: `The ${summary.label.toLowerCase()} is referenced but not downloaded. Open the source or run the worker to capture it.`,
      code,
      headline: `${summary.label} referenced only`,
      next: { href: summary.sourceUrl, kind: "link", label: "Open referenced source" },
      tone: "review"
    };
  }

  if (summary.state === "downloaded") {
    return {
      body: `The ${summary.label.toLowerCase()} file is captured but not validated. Re-run validation to mark it exportable.`,
      code,
      headline: `${summary.label} not validated`,
      next: { command: "npm run dev:worker", kind: "command", label: "Run worker to validate asset" },
      tone: "review"
    };
  }

  return {
    body: `The ${summary.label.toLowerCase()} is not yet exportable.`,
    code,
    headline: `${summary.label} not ready`,
    next: { command: "npm run dev:worker", kind: "command", label: `Run worker to fetch ${summary.label.toLowerCase()}` },
    tone: "review"
  };
}

/**
 * Maps a SourceRecord to a compact provenance row.
 */
function toProvenanceRow(source: PartSearchRecord["sources"][number]): PartDetailProvenanceRow {
  return {
    fetchedAt: source.fetchedAt,
    id: source.id,
    normalizedAt: source.normalizedAt,
    providerId: source.providerId,
    providerPartKey: source.providerPartKey,
    sourceUrl: source.sourceUrl
  };
}
