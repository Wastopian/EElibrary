/**
 * File header: Builds typed provider-neutral part detail responses from a chosen catalog record set.
 */

import type { PartDetailResponse, PartSearchRecord, RelatedPartSummary } from "@ee-library/shared/types";
import { getBundleReadinessSummary, getGenerationOptions, resolveAssetClassSummaries } from "@ee-library/shared/asset-resolution";

/**
 * Builds the typed detail response from the same backing records used by the route.
 */
export function buildPartDetailResponse(record: PartSearchRecord, records: PartSearchRecord[]): PartDetailResponse {
  const relatedIds = new Set<string>([
    ...record.mateRelations.map((relation) => relation.matePartId),
    ...record.accessoryRequirements.map((relation) => relation.accessoryPartId),
    ...record.cableCompatibilities.map((relation) => relation.cablePartId),
    ...record.similarParts.map((relation) => relation.similarPartId),
    ...record.companionRecommendations.map((relation) => relation.companionPartId)
  ]);

  const relatedPartSummaries = records
    .filter((candidate) => relatedIds.has(candidate.part.id))
    .map<RelatedPartSummary>((candidate) => ({
      category: candidate.part.category,
      id: candidate.part.id,
      manufacturerName: candidate.manufacturer.name,
      mpn: candidate.part.mpn
    }))
    .sort((left, right) => left.mpn.localeCompare(right.mpn));

  const assetGroups = resolveAssetClassSummaries(record.assets);

  return {
    assetGroups,
    bundleReadiness: getBundleReadinessSummary(record),
    generationOptions: getGenerationOptions(record, assetGroups),
    record,
    relatedPartSummaries
  };
}
