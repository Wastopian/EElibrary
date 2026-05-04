/**
 * File header: Maps exact-match normalized provider records into provider-neutral lookup candidate rows.
 */

import type { ProviderLookupCandidateBase, ProviderLookupMatchType } from "@ee-library/shared/types";
import type { NormalizedProviderPart } from "./provider-adapters";

/**
 * Maps one exact-match normalized provider record into the provider-neutral candidate row used by the API.
 */
export function buildExactLookupCandidate(
  normalizedPart: NormalizedProviderPart,
  query: string
): ProviderLookupCandidateBase {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesMpn = normalizedPart.part.mpn.trim().toLowerCase() === normalizedQuery;
  const matchesProviderPartId =
    normalizedPart.sourceRecord.providerPartKey.trim().toLowerCase() === normalizedQuery;

  if (!matchesMpn && !matchesProviderPartId) {
    throw new Error("Normalized provider record does not exactly match the requested lookup.");
  }

  const matchType: ProviderLookupMatchType = matchesMpn ? "exact_mpn" : "exact_provider_part_id";

  return {
    manufacturerName: normalizedPart.manufacturer.name,
    matchConfidence: 1,
    matchType,
    mpn: normalizedPart.part.mpn,
    package: normalizedPart.package.packageName,
    providerId: normalizedPart.sourceRecord.providerId,
    providerPartKey: normalizedPart.sourceRecord.providerPartKey,
    sourceUrl: normalizedPart.sourceRecord.sourceUrl
  };
}
