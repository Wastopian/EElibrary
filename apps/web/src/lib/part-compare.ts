/**
 * Provider-neutral helpers for the part compare workspace (metric union, asset-class
 * readiness rows, connector-depth rows, and cell formatting).
 */

import { resolveAssetClassSummaries } from "@ee-library/shared/asset-resolution";
import { getAssetReviewStatus } from "@ee-library/shared/review-workflow";
import { formatMetricLabel, formatMetricValue, formatParameterLabel, formatParameterValue } from "@ee-library/shared/catalog-runtime";
import { assetTrustStageTone, formatAssetTrustStageLabel } from "./detail-view-model";
import { getAssetPreviewState } from "../components/AssetInlinePreview";
import type { AssetPreviewState } from "../components/AssetInlinePreview";
import type {
  Asset,
  AssetClassReadiness,
  AssetType,
  PartDetailResponse,
  PartSearchRecord
} from "@ee-library/shared/types";

/** CompareCellTone is a small badge-tone vocabulary shared across compare rows. */
export type CompareCellTone = "neutral" | "info" | "verified" | "review" | "danger";

/** CompareCellValue is one part's value in a compare row. */
export interface CompareCellValue {
  partId: string;
  text: string;
  tone: CompareCellTone;
}

/** CompareRow is one labelled row across the compared records. */
export interface CompareRow {
  /** Stable id for tests and rendering keys. */
  rowKey: string;
  label: string;
  values: CompareCellValue[];
}

/**
 * Collects sorted metric keys present on any compared record.
 */
export function collectCompareMetricKeys(records: PartSearchRecord[]): string[] {
  const keys = new Set<string>();

  for (const record of records) {
    for (const metric of record.metrics) {
      keys.add(metric.metricKey);
    }
  }

  return [...keys].sort((first, second) => formatMetricLabel(first).localeCompare(formatMetricLabel(second)));
}

/**
 * Formats one metric cell for a record, or an em dash when the metric is absent.
 */
export function formatCompareMetricCell(record: PartSearchRecord, metricKey: string): string {
  const metric = record.metrics.find((candidate) => candidate.metricKey === metricKey);

  return metric ? formatMetricValue(metric) : "—";
}

/**
 * Builds compare rows from successful detail responses only.
 */
export function detailsToRecords(details: PartDetailResponse[]): PartSearchRecord[] {
  return details.map((detail) => detail.record);
}

/**
 * Collects sorted normalized-parameter keys present on any compared part.
 *
 * Reads `detail.parameters` (the reconciled part_parameters), which the compare loader already fetches
 * per part and which `detailsToRecords` drops -- so no extra request is needed.
 */
export function collectCompareParameterKeys(details: PartDetailResponse[]): string[] {
  const keys = new Set<string>();

  for (const detail of details) {
    for (const parameter of detail.parameters) {
      keys.add(parameter.paramKey);
    }
  }

  return [...keys].sort((first, second) => formatParameterLabel(first).localeCompare(formatParameterLabel(second)));
}

/**
 * Builds the normalized-parameter matrix rows: one row per parameter key, one cell per part with the
 * typed value in canonical units, an em dash when absent, and a conflict marker when sources disagree.
 */
export function buildCompareParameterRows(details: PartDetailResponse[]): CompareRow[] {
  return collectCompareParameterKeys(details).map<CompareRow>((paramKey) => ({
    label: formatParameterLabel(paramKey),
    rowKey: `parameter:${paramKey}`,
    values: details.map<CompareCellValue>((detail) => {
      const parameter = detail.parameters.find((candidate) => candidate.paramKey === paramKey);

      if (!parameter) {
        return { partId: detail.record.part.id, text: "—", tone: "neutral" };
      }

      return {
        partId: detail.record.part.id,
        text: `${formatParameterValue(parameter)}${parameter.isConflicted ? " · sources disagree" : ""}`,
        tone: parameter.isConflicted ? "review" : "info"
      };
    })
  }));
}

const ASSET_CLASS_LABELS: Record<AssetType, string> = {
  datasheet: "Datasheet",
  footprint: "Footprint",
  mechanical_drawing: "Mechanical drawing",
  symbol: "Symbol",
  three_d_model: "3D model"
};

const ASSET_CLASS_READINESS_LABELS: Record<AssetClassReadiness, string> = {
  downloaded_file: "Downloaded",
  export_ready: "Export-ready",
  failed: "Failed",
  missing: "Missing",
  reference_only: "Reference only",
  validated_file: "Validated"
};

const ASSET_CLASS_READINESS_TONES: Record<AssetClassReadiness, CompareCellTone> = {
  downloaded_file: "review",
  export_ready: "verified",
  failed: "danger",
  missing: "neutral",
  reference_only: "review",
  validated_file: "verified"
};

/**
 * Builds asset-class readiness rows (one row per engineering asset class) so the compare
 * workspace can show whether each part has a usable Symbol / Footprint / 3D / Datasheet /
 * Mechanical drawing without the engineer having to open every detail page.
 *
 * Rows are stable in `ENGINEERING_ASSET_TYPES` order. When a record has no assets in a
 * class, the cell renders "Missing" rather than disappearing — same honesty rule as the
 * detail page.
 */
export function buildCompareAssetClassRows(records: PartSearchRecord[]): CompareRow[] {
  const summariesByPart = new Map(
    records.map((record) => [record.part.id, resolveAssetClassSummaries(record.assets)])
  );

  // Order the rows by the same canonical engineering-asset order
  // resolveAssetClassSummaries uses, but only include classes any record actually carries.
  const firstSummaries = records[0] ? summariesByPart.get(records[0].part.id) : undefined;
  const orderedAssetTypes = (firstSummaries ?? []).map((summary) => summary.assetType);

  return orderedAssetTypes.map<CompareRow>((assetType) => ({
    label: ASSET_CLASS_LABELS[assetType],
    rowKey: `asset_class:${assetType}`,
    values: records.map<CompareCellValue>((record) => {
      const summary = (summariesByPart.get(record.part.id) ?? []).find(
        (candidate) => candidate.assetType === assetType
      );
      const readiness = summary?.readiness ?? "missing";

      return {
        partId: record.part.id,
        text: ASSET_CLASS_READINESS_LABELS[readiness],
        tone: ASSET_CLASS_READINESS_TONES[readiness]
      };
    })
  }));
}

/**
 * Returns true when at least one compared record carries connector data (so the
 * connector-depth section is worth rendering).
 */
export function shouldRenderConnectorCompareRows(records: PartSearchRecord[]): boolean {
  return records.some((record) => recordHasConnectorContext(record));
}

function recordHasConnectorContext(record: PartSearchRecord): boolean {
  return (
    record.connectorFamily !== null
    || record.mateRelations.length > 0
    || record.accessoryRequirements.length > 0
    || record.cableCompatibilities.length > 0
  );
}

/**
 * Builds the connector-depth rows for the compare workspace.
 *
 * Each row stays honest about non-connector parts (renders "Not a connector") so a
 * mixed connector vs non-connector compare is still readable.
 */
export function buildCompareConnectorRows(records: PartSearchRecord[]): CompareRow[] {
  return [
    buildConnectorClassRow(records),
    buildBestMateRow(records),
    buildAlternateMateRow(records),
    buildRequiredAccessoryRow(records),
    buildFamilyConflictRow(records),
    buildConnectorConfidenceRow(records)
  ];
}

/**
 * Builds per-asset trust-stage rows so compare can show stage differences
 * (generated draft vs approved vs verified-for-export) by asset class.
 */
export function buildCompareAssetTrustRows(records: PartSearchRecord[]): CompareRow[] {
  const summariesByPart = new Map(
    records.map((record) => [record.part.id, resolveAssetClassSummaries(record.assets)])
  );
  const firstSummaries = records[0] ? summariesByPart.get(records[0].part.id) : undefined;
  const orderedAssetTypes = (firstSummaries ?? []).map((summary) => summary.assetType);

  return orderedAssetTypes.map<CompareRow>((assetType) => ({
    label: `${ASSET_CLASS_LABELS[assetType]} trust stage`,
    rowKey: `asset_trust:${assetType}`,
    values: records.map<CompareCellValue>((record) => {
      const summary = (summariesByPart.get(record.part.id) ?? []).find(
        (candidate) => candidate.assetType === assetType
      );
      const bestAsset = summary?.bestAsset;
      if (!bestAsset) {
        return { partId: record.part.id, text: "Missing", tone: "neutral" };
      }

      const reviewState = getAssetReviewStatus(bestAsset, record.reviewRecords).state;
      const tone = assetTrustStageTone(bestAsset, reviewState);
      return {
        partId: record.part.id,
        text: formatAssetTrustStageLabel(bestAsset, reviewState),
        tone: tone === "verified" || tone === "danger" || tone === "info" || tone === "review" ? tone : "review"
      };
    })
  }));
}

/**
 * COMPARE_PREVIEW_ASSET_TYPES is the explicit, ordered list of CAD asset classes the
 * compare preview band renders side-by-side: symbol, footprint, and 3D model.
 *
 * Datasheets and mechanical drawings are intentionally excluded — the preview band is
 * about CAD diff at a glance, and datasheets already get their own inline preview on the
 * detail page where reading them at length is a deliberate task. Adding datasheets here
 * would crowd the side-by-side and dilute the CAD-diff payoff.
 */
export const COMPARE_PREVIEW_ASSET_TYPES: ReadonlyArray<Extract<AssetType, "symbol" | "footprint" | "three_d_model">> = [
  "symbol",
  "footprint",
  "three_d_model"
];

/** ComparePreviewAssetType narrows AssetType to the classes the preview band renders. */
export type ComparePreviewAssetType = (typeof COMPARE_PREVIEW_ASSET_TYPES)[number];

/**
 * ComparePreviewCell describes one part's slot in the side-by-side preview band for one
 * asset class. The shape is intentionally serialization-friendly so a server component
 * can hand it directly to a small client renderer that mounts <iframe>/<img>/<model-viewer>
 * exactly when the state is one of the embeddable kinds.
 *
 * Honesty rules baked in:
 *  - `bestAsset` is null when the part has no asset of this class — the renderer must
 *    show "Missing" rather than an empty card so the engineer can see the gap.
 *  - `previewState` is computed from the same `getAssetPreviewState` the detail page
 *    uses, so a STEP without a derived viewer artifact stays "three_d_preview_pending_artifact"
 *    here just as it would on the detail page. We never fabricate "ready" for the side-by-side.
 *  - `partId` and `assetId` are exposed so the renderer can build the artifact URL with
 *    `buildAssetDownloadUrl` / `buildAssetPreviewArtifactDownloadUrl` without the helper
 *    needing to know about the API base URL or downloads.
 */
export interface ComparePreviewCell {
  partId: string;
  partMpn: string;
  assetType: ComparePreviewAssetType;
  bestAsset: Asset | null;
  previewState: AssetPreviewState | null;
}

/** ComparePreviewRow is one CAD asset class compared side-by-side across selected parts. */
export interface ComparePreviewRow {
  rowKey: string;
  label: string;
  assetType: ComparePreviewAssetType;
  cells: ComparePreviewCell[];
}

const COMPARE_PREVIEW_LABELS: Record<ComparePreviewAssetType, string> = {
  symbol: "Symbol",
  footprint: "Footprint",
  three_d_model: "3D model"
};

/**
 * Builds side-by-side CAD preview rows for the compare workspace, one row per CAD asset
 * class (symbol, footprint, 3D model) with one cell per compared part.
 *
 * The plan calls this out as the payoff of the 3D/STEP preview pipeline: an engineer
 * should be able to land on /compare and see the CAD diff at a glance without opening
 * each detail page. Honesty discipline is preserved by reusing `getAssetPreviewState`
 * verbatim, so every cell stays on the same five-state matrix the detail page uses
 * (stored inline / pending artifact / reference only / unsupported / pending / not
 * available). The caller is expected to render the per-asset trust-stage diff row from
 * `buildCompareAssetTrustRows` directly adjacent so engineers never confuse "preview
 * renders" with "asset is approved or verified for export".
 */
export function buildCompareAssetPreviewRows(records: PartSearchRecord[]): ComparePreviewRow[] {
  const summariesByPart = new Map(
    records.map((record) => [record.part.id, resolveAssetClassSummaries(record.assets)])
  );

  return COMPARE_PREVIEW_ASSET_TYPES.map<ComparePreviewRow>((assetType) => ({
    assetType,
    label: COMPARE_PREVIEW_LABELS[assetType],
    rowKey: `asset_preview:${assetType}`,
    cells: records.map<ComparePreviewCell>((record) => {
      const summary = (summariesByPart.get(record.part.id) ?? []).find(
        (candidate) => candidate.assetType === assetType
      );
      const bestAsset = summary?.bestAsset ?? null;

      return {
        assetType,
        bestAsset,
        partId: record.part.id,
        partMpn: record.part.mpn,
        previewState: bestAsset ? getAssetPreviewState(bestAsset) : null
      };
    })
  }));
}

function buildConnectorClassRow(records: PartSearchRecord[]): CompareRow {
  return {
    label: "Connector class",
    rowKey: "connector:class",
    values: records.map<CompareCellValue>((record) => {
      if (!recordHasConnectorContext(record)) {
        return { partId: record.part.id, text: "Not a connector", tone: "neutral" };
      }

      const className = record.readinessSummary.connectorClass;
      return { partId: record.part.id, text: className, tone: "info" };
    })
  };
}

function buildBestMateRow(records: PartSearchRecord[]): CompareRow {
  return {
    label: "Best mate",
    rowKey: "connector:best_mate",
    values: records.map<CompareCellValue>((record) => {
      if (!recordHasConnectorContext(record)) {
        return { partId: record.part.id, text: "—", tone: "neutral" };
      }

      const bestMate = record.buildableMatingSet.bestMate;

      if (!bestMate) {
        return { partId: record.part.id, text: "No mate mapped", tone: "review" };
      }

      const confidencePercent = Math.round(bestMate.confidenceScore * 100);
      return {
        partId: record.part.id,
        text: `${bestMate.matePartId} (${confidencePercent}%)`,
        tone: confidencePercent >= 75 ? "verified" : "review"
      };
    })
  };
}

function buildAlternateMateRow(records: PartSearchRecord[]): CompareRow {
  return {
    label: "Alternate mates",
    rowKey: "connector:alternate_mates",
    values: records.map<CompareCellValue>((record) => {
      if (!recordHasConnectorContext(record)) {
        return { partId: record.part.id, text: "—", tone: "neutral" };
      }

      const count = record.buildableMatingSet.alternateMates.length;
      return {
        partId: record.part.id,
        text: count === 0 ? "None" : `${count}`,
        tone: count > 0 ? "info" : "neutral"
      };
    })
  };
}

function buildRequiredAccessoryRow(records: PartSearchRecord[]): CompareRow {
  return {
    label: "Required accessories",
    rowKey: "connector:required_accessories",
    values: records.map<CompareCellValue>((record) => {
      if (!recordHasConnectorContext(record)) {
        return { partId: record.part.id, text: "—", tone: "neutral" };
      }

      const count = record.buildableMatingSet.requiredAccessories.length;
      return {
        partId: record.part.id,
        text: count === 0 ? "None recorded" : `${count}`,
        tone: count > 0 ? "info" : "review"
      };
    })
  };
}

function buildFamilyConflictRow(records: PartSearchRecord[]): CompareRow {
  return {
    label: "Family conflicts",
    rowKey: "connector:family_conflicts",
    values: records.map<CompareCellValue>((record) => {
      if (!recordHasConnectorContext(record)) {
        return { partId: record.part.id, text: "—", tone: "neutral" };
      }

      const count = record.buildableMatingSet.familyConflicts.length;
      return {
        partId: record.part.id,
        text: count === 0 ? "None" : `${count}`,
        tone: count > 0 ? "danger" : "verified"
      };
    })
  };
}

function buildConnectorConfidenceRow(records: PartSearchRecord[]): CompareRow {
  return {
    label: "Mating confidence",
    rowKey: "connector:confidence",
    values: records.map<CompareCellValue>((record) => {
      if (!recordHasConnectorContext(record)) {
        return { partId: record.part.id, text: "—", tone: "neutral" };
      }

      const score = record.buildableMatingSet.confidenceBreakdown.overallScore;

      if (score === null) {
        return { partId: record.part.id, text: "Not scored", tone: "neutral" };
      }

      const percent = Math.round(score * 100);
      return {
        partId: record.part.id,
        text: `${percent}%`,
        tone: percent >= 75 ? "verified" : percent >= 50 ? "review" : "danger"
      };
    })
  };
}
