/**
 * File header: Builds read-only metric rollups for reusable circuit-block linked parts.
 *
 * The rollup is deliberately presentation-free. It groups normalized datasheet metrics by
 * metric key and unit across the parts linked into a circuit block, then carries coverage and
 * confidence signals forward without turning them into approval, validation, or export gates.
 */

import type {
  CircuitBlockMetricRollup,
  CircuitBlockMetricRollupEntry,
  CircuitBlockMetricRoleValue,
  CircuitBlockPartRecord,
  PartMetric
} from "./types";

/** CIRCUIT_BLOCK_METRIC_ROLLUP_BOUNDARY is repeated anywhere the summary is shown. */
export const CIRCUIT_BLOCK_METRIC_ROLLUP_BOUNDARY =
  "Linked-part metrics are a read-only datasheet rollup with source confidence. They do not approve the circuit block, approve linked parts, validate assets, or unlock export.";

/**
 * Builds a deterministic datasheet-style metric rollup from linked block roles and part metrics.
 *
 * Duplicate metrics on the same part are reduced to the most trusted candidate for the same
 * metric key and unit before the cross-role rollup is assembled. This keeps the UI dense and
 * predictable while preserving the original PartMetric object for provenance drill-down.
 */
export function buildCircuitBlockMetricRollup(
  parts: CircuitBlockPartRecord[],
  metrics: PartMetric[]
): CircuitBlockMetricRollup {
  const metricsByPartId = groupMetricsByPartId(metrics);
  const entriesByMetric = new Map<string, CircuitBlockMetricRollupEntry>();
  const rolesWithAnyMetric = new Set<string>();

  for (const partRecord of parts) {
    const partMetrics = metricsByPartId.get(partRecord.blockPart.partId) ?? [];
    const selectedMetrics = selectBestMetricsByMetricAndUnit(partMetrics);

    if (selectedMetrics.length > 0) {
      rolesWithAnyMetric.add(partRecord.blockPart.id);
    }

    for (const metric of selectedMetrics) {
      const metricGroupKey = buildMetricGroupKey(metric);
      const roleValue = buildMetricRoleValue(partRecord, metric);
      const existingEntry = entriesByMetric.get(metricGroupKey);

      if (existingEntry) {
        existingEntry.values.push(roleValue);
      } else {
        entriesByMetric.set(metricGroupKey, {
          averageConfidenceScore: null,
          coverageStatus: "missing",
          coveredOptionalRoleCount: 0,
          coveredRequiredRoleCount: 0,
          metricKey: metric.metricKey,
          minConfidenceScore: null,
          missingOptionalRoles: [],
          missingRequiredRoles: [],
          optionalRoleCount: 0,
          requiredRoleCount: 0,
          unit: metric.unit,
          values: [roleValue]
        });
      }
    }
  }

  const entries = Array.from(entriesByMetric.values()).map((entry) => finalizeMetricRollupEntry(entry, parts));
  entries.sort(compareMetricRollupEntries);

  return {
    boundary: CIRCUIT_BLOCK_METRIC_ROLLUP_BOUNDARY,
    entries,
    metricCount: entries.length,
    rolesWithAnyMetricCount: rolesWithAnyMetric.size,
    state: entries.length > 0 ? "available" : "empty",
    totalRoleCount: parts.length
  };
}

/**
 * Groups raw metrics by part id so each circuit-block role can read only its linked part metrics.
 */
function groupMetricsByPartId(metrics: PartMetric[]): Map<string, PartMetric[]> {
  const byPartId = new Map<string, PartMetric[]>();

  for (const metric of metrics) {
    byPartId.set(metric.partId, [...(byPartId.get(metric.partId) ?? []), metric]);
  }

  return byPartId;
}

/**
 * Chooses the best metric per metric-key/unit pair for one part.
 */
function selectBestMetricsByMetricAndUnit(metrics: PartMetric[]): PartMetric[] {
  const byMetricAndUnit = new Map<string, PartMetric>();

  for (const metric of metrics) {
    const groupKey = buildMetricGroupKey(metric);
    const existing = byMetricAndUnit.get(groupKey);

    if (!existing || compareMetricPreference(metric, existing) < 0) {
      byMetricAndUnit.set(groupKey, metric);
    }
  }

  return Array.from(byMetricAndUnit.values()).sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey) ||
    left.unit.localeCompare(right.unit) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Compares two same-key metrics by confidence, recency, and id for deterministic dedupe.
 */
function compareMetricPreference(left: PartMetric, right: PartMetric): number {
  if (left.confidenceScore !== right.confidenceScore) {
    return right.confidenceScore - left.confidenceScore;
  }

  const recencyDelta = toTimestamp(right.lastUpdatedAt) - toTimestamp(left.lastUpdatedAt);
  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  return left.id.localeCompare(right.id);
}

/**
 * Builds the stable rollup grouping key for metrics that share the same engineering unit.
 */
function buildMetricGroupKey(metric: PartMetric): string {
  return `${metric.metricKey}::${metric.unit}`;
}

/**
 * Preserves the linked part-role context next to the selected normalized metric.
 */
function buildMetricRoleValue(partRecord: CircuitBlockPartRecord, metric: PartMetric): CircuitBlockMetricRoleValue {
  return {
    blockPartId: partRecord.blockPart.id,
    isRequired: partRecord.blockPart.isRequired,
    manufacturerName: partRecord.part.manufacturerName,
    metric,
    mpn: partRecord.part.mpn,
    partId: partRecord.part.partId,
    quantity: partRecord.blockPart.quantity,
    role: partRecord.blockPart.role
  };
}

/**
 * Completes coverage, confidence, and missing-role fields for one metric group.
 */
function finalizeMetricRollupEntry(
  entry: CircuitBlockMetricRollupEntry,
  parts: CircuitBlockPartRecord[]
): CircuitBlockMetricRollupEntry {
  const coveredRoleIds = new Set(entry.values.map((value) => value.blockPartId));
  const requiredRoles = parts.filter((part) => part.blockPart.isRequired);
  const optionalRoles = parts.filter((part) => !part.blockPart.isRequired);
  const missingRequiredRoles = requiredRoles
    .filter((part) => !coveredRoleIds.has(part.blockPart.id))
    .map(buildRoleLabel);
  const missingOptionalRoles = optionalRoles
    .filter((part) => !coveredRoleIds.has(part.blockPart.id))
    .map(buildRoleLabel);
  const coveredRequiredRoleCount = requiredRoles.length - missingRequiredRoles.length;
  const coveredOptionalRoleCount = optionalRoles.length - missingOptionalRoles.length;
  const confidenceScores = entry.values.map((value) => value.metric.confidenceScore);
  const minConfidenceScore = confidenceScores.length > 0 ? Math.min(...confidenceScores) : null;
  const averageConfidenceScore = confidenceScores.length > 0
    ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
    : null;

  entry.values.sort(compareMetricRoleValues);

  return {
    ...entry,
    averageConfidenceScore,
    coverageStatus: getCoverageStatus(coveredRequiredRoleCount, requiredRoles.length, entry.values.length),
    coveredOptionalRoleCount,
    coveredRequiredRoleCount,
    minConfidenceScore,
    missingOptionalRoles,
    missingRequiredRoles,
    optionalRoleCount: optionalRoles.length,
    requiredRoleCount: requiredRoles.length
  };
}

/**
 * Reports required-role coverage without implying that missing metrics block reuse.
 */
function getCoverageStatus(
  coveredRequiredRoleCount: number,
  requiredRoleCount: number,
  valueCount: number
): CircuitBlockMetricRollupEntry["coverageStatus"] {
  if (valueCount === 0) {
    return "missing";
  }

  if (requiredRoleCount === 0 || coveredRequiredRoleCount === requiredRoleCount) {
    return "complete";
  }

  return "partial";
}

/**
 * Sorts role values in the same engineer-friendly order as circuit-block roles.
 */
function compareMetricRoleValues(left: CircuitBlockMetricRoleValue, right: CircuitBlockMetricRoleValue): number {
  if (left.isRequired !== right.isRequired) {
    return left.isRequired ? -1 : 1;
  }

  return left.role.localeCompare(right.role) ||
    left.mpn.localeCompare(right.mpn) ||
    left.blockPartId.localeCompare(right.blockPartId);
}

/**
 * Sorts metric groups so high-coverage, high-confidence metrics are most visible.
 */
function compareMetricRollupEntries(left: CircuitBlockMetricRollupEntry, right: CircuitBlockMetricRollupEntry): number {
  return coverageRank(right.coverageStatus) - coverageRank(left.coverageStatus) ||
    right.coveredRequiredRoleCount - left.coveredRequiredRoleCount ||
    right.values.length - left.values.length ||
    (right.averageConfidenceScore ?? -1) - (left.averageConfidenceScore ?? -1) ||
    left.metricKey.localeCompare(right.metricKey) ||
    left.unit.localeCompare(right.unit);
}

/**
 * Converts coverage labels into a sort rank for the rollup table.
 */
function coverageRank(status: CircuitBlockMetricRollupEntry["coverageStatus"]): number {
  if (status === "complete") return 2;
  if (status === "partial") return 1;
  return 0;
}

/**
 * Builds a readable role label for coverage summaries and tests.
 */
function buildRoleLabel(partRecord: CircuitBlockPartRecord): string {
  return `${partRecord.blockPart.role} (${partRecord.part.mpn})`;
}

/**
 * Parses timestamps for deterministic recency comparison.
 */
function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
