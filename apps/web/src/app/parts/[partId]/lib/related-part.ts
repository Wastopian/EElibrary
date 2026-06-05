/**
 * File header: Helpers that render related-part references with confidence/notes.
 *
 * Pure string-builders — used by mate, accessory, and cable-assumption listings
 * on the part detail page.
 */

import type { RelatedPartSummary } from "@ee-library/shared/types";
import type { PartDetailPageRecord } from "./types";

/**
 * Finds lightweight display data for a related part identifier.
 */
export function findRelatedPart(partId: string, relatedPartSummaries: RelatedPartSummary[]): RelatedPartSummary | null {
  return relatedPartSummaries.find((item) => item.id === partId) ?? null;
}

/**
 * Renders one related part reference.
 */
export function renderPart(partId: string, relatedPartSummaries: RelatedPartSummary[]): string {
  const related = findRelatedPart(partId, relatedPartSummaries);
  return related ? `${related.mpn} (${related.manufacturerName})` : partId;
}

/**
 * Renders a comma-separated related part list with an explicit empty state.
 */
export function renderRelatedList(partIds: string[], relatedPartSummaries: RelatedPartSummary[]): string {
  if (partIds.length === 0) return "None";
  return partIds.map((partId) => renderPart(partId, relatedPartSummaries)).join(", ");
}

/**
 * Renders mate relations with confidence so near-match alternatives remain reviewable.
 */
export function renderMateRelationList(
  relations: PartDetailPageRecord["buildableMatingSet"]["alternateMates"],
  relatedPartSummaries: RelatedPartSummary[]
): string {
  if (relations.length === 0) {
    return "None";
  }

  return relations
    .map((relation) => `${renderPart(relation.matePartId, relatedPartSummaries)} (${Math.round(relation.confidenceScore * 100)}%)`)
    .join(", ");
}

/**
 * Renders parsed cable assumptions without implying the assumptions were independently validated.
 */
export function renderCableAssumptionList(
  assumptions: PartDetailPageRecord["buildableMatingSet"]["cableAssumptions"],
  relatedPartSummaries: RelatedPartSummary[]
): string {
  if (assumptions.length === 0) {
    return "None recorded";
  }

  return assumptions
    .map((assumption) => `${renderPart(assumption.cablePartId, relatedPartSummaries)}: ${assumption.summary}`)
    .join(" | ");
}
