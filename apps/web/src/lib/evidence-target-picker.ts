/**
 * File header: Provides provider-neutral helpers for choosing durable evidence targets.
 */

import type { EvidenceTargetType } from "@ee-library/shared/types";

/** EvidenceTargetTypeOption is one allowed evidence target family in the UI selector. */
export interface EvidenceTargetTypeOption {
  /** Human-readable target family label. */
  label: string;
  /** API target type value that will be submitted with evidence metadata. */
  value: EvidenceTargetType;
}

/** EvidenceTargetPickerOption describes one persisted target candidate without changing trust state. */
export interface EvidenceTargetPickerOption {
  /** Target type accepted by the evidence attachment API. */
  targetType: EvidenceTargetType;
  /** Persisted target id submitted to the API when selected. */
  targetId: string;
  /** Primary operator-facing label for the picker row. */
  label: string;
  /** Secondary context that helps distinguish similarly named targets. */
  detail: string;
  /** Source of the suggestion, such as projects, BOM health, or current vault rows. */
  source: string;
}

/** evidenceTargetTypeOptions lists target types supported by the API evidence contract. */
export const evidenceTargetTypeOptions: EvidenceTargetTypeOption[] = [
  { label: "Project", value: "project" },
  { label: "Part", value: "part" },
  { label: "BOM import", value: "bom_import" },
  { label: "BOM line", value: "bom_line" },
  { label: "Project usage", value: "project_part_usage" },
  { label: "Risk finding", value: "risk_finding" },
  { label: "Circuit block", value: "circuit_block" },
  { label: "Circuit block part", value: "circuit_block_part" },
  { label: "Asset", value: "asset" }
];

/**
 * Builds a stable option key from target type and id.
 */
export function buildEvidenceTargetPickerOptionKey(targetType: EvidenceTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/**
 * Filters target picker options by type and operator query while preserving deterministic order.
 */
export function filterEvidenceTargetPickerOptions(
  options: EvidenceTargetPickerOption[],
  targetType: EvidenceTargetType,
  query: string,
  limit = 16
): EvidenceTargetPickerOption[] {
  const normalizedQuery = normalizePickerText(query);

  return options
    .filter((option) => option.targetType === targetType)
    .filter((option) => {
      if (!normalizedQuery) {
        return true;
      }

      return normalizePickerText(`${option.targetId} ${option.label} ${option.detail} ${option.source}`).includes(normalizedQuery);
    })
    .slice(0, limit);
}

/**
 * Reads supported evidence target types without trusting raw DOM or query values.
 */
export function readEvidenceTargetType(value: string): EvidenceTargetType {
  return evidenceTargetTypeOptions.find((option) => option.value === value)?.value ?? "project";
}

/**
 * Formats evidence target type values for compact helper copy.
 */
export function formatEvidenceTargetTypeLabel(targetType: EvidenceTargetType): string {
  return evidenceTargetTypeOptions.find((option) => option.value === targetType)?.label ?? "Target";
}

/**
 * Returns a target-specific search placeholder for the evidence picker.
 */
export function getEvidenceTargetPlaceholder(targetType: EvidenceTargetType): string {
  if (targetType === "part") return "Search MPN, manufacturer, or part id";
  if (targetType === "bom_import") return "Search BOM filename, import id, or project";
  if (targetType === "bom_line") return "Search row, raw MPN, designator, or line id";
  if (targetType === "project_part_usage") return "Search MPN, designator, usage id, or project";
  if (targetType === "risk_finding") return "Search finding title, code, or project";
  if (targetType === "circuit_block") return "Search block key, name, or block id";
  if (targetType === "circuit_block_part") return "Search block role, part id, or role id";
  if (targetType === "asset") return "Paste or search an asset id";
  return "Search project key, name, or project id";
}

/**
 * Normalizes picker text for case-insensitive contains matching.
 */
function normalizePickerText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
