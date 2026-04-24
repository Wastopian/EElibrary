/**
 * File header: Builds typed provider-neutral part detail responses from a chosen catalog record set.
 */

import type { PartAcquisitionSummary, PartDetailResponse, PartSearchRecord, RelatedPartSummary } from "@ee-library/shared/types";
import { getBundleReadinessSummary, getGenerationOptions, resolveAssetClassSummaries } from "@ee-library/shared/asset-resolution";
import { getAssetPromotionSummaries, getAssetReviewStatuses, getAssetValidationSummaries, getWorkflowReviewStatuses } from "@ee-library/shared/review-workflow";

/**
 * Builds the typed detail response from the same backing records used by the route.
 */
export function buildPartDetailResponse(
  record: PartSearchRecord,
  records: PartSearchRecord[],
  acquisitionSummary: PartAcquisitionSummary = buildNotRecordedPartAcquisitionSummary()
): PartDetailResponse {
  const relatedIds = new Set<string>([
    ...record.mateRelations.map((relation) => relation.matePartId),
    ...record.accessoryRequirements.map((relation) => relation.accessoryPartId),
    ...record.cableCompatibilities.map((relation) => relation.cablePartId),
    ...record.connectorFamilyConflicts.map((conflict) => conflict.candidatePartId),
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
    acquisitionSummary: fillAcquisitionSummaryIdentity(acquisitionSummary, record),
    assetReviewStatuses: getAssetReviewStatuses(record.assets, record.reviewRecords),
    assetGroups,
    assetPromotionSummaries: getAssetPromotionSummaries(record.assets, record.validationRecords, record.promotionAudits),
    assetValidationSummaries: getAssetValidationSummaries(record.assets, record.validationRecords),
    bundleReadiness: getBundleReadinessSummary(record),
    generationOptions: getGenerationOptions(record, assetGroups),
    record,
    relatedPartSummaries,
    workflowReviewStatuses: getWorkflowReviewStatuses(record.generationWorkflows, record.reviewRecords)
  };
}

/**
 * Builds the honest default when a detail response has no recorded acquisition job or source evidence.
 */
export function buildNotRecordedPartAcquisitionSummary(): PartAcquisitionSummary {
  return {
    completedAt: null,
    lastJobStatus: null,
    manufacturerName: null,
    mpn: null,
    providerId: null,
    providerPartKey: null,
    reason: "No provider acquisition job or attached provider source evidence is recorded for this part yet.",
    requestedAt: null,
    requestedBy: null,
    requestedLookup: null,
    sourceUrl: null,
    state: "not_recorded"
  };
}

/**
 * Builds the explicit unavailable state used when detail data is served without DB-backed acquisition history.
 */
export function buildUnavailablePartAcquisitionSummary(reason: string): PartAcquisitionSummary {
  return {
    ...buildNotRecordedPartAcquisitionSummary(),
    reason,
    state: "unavailable"
  };
}

/**
 * Ensures the detail payload always includes canonical MPN and manufacturer context even when job history is sparse.
 */
function fillAcquisitionSummaryIdentity(summary: PartAcquisitionSummary, record: PartSearchRecord): PartAcquisitionSummary {
  return {
    ...summary,
    manufacturerName: summary.manufacturerName ?? record.manufacturer.name,
    mpn: summary.mpn ?? record.part.mpn
  };
}
