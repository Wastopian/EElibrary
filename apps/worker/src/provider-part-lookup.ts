/**
 * File header: Runs explicit exact-match provider candidate lookup without persisting any catalog rows.
 */

import { providerAdapters } from "./provider-adapters";
import type { ProviderLookupCandidateBase } from "@ee-library/shared/types";
import type { ProviderExactLookupRequest } from "./provider-adapters";

export type { ProviderExactLookupRequest } from "./provider-adapters";

/**
 * Queries every registered provider adapter for exact-match candidates and preserves adapter registry order.
 */
export async function runProviderPartLookup(request: ProviderExactLookupRequest): Promise<ProviderLookupCandidateBase[]> {
  const results = await Promise.all(
    providerAdapters.map((adapter) => adapter.findExactPartCandidates(request))
  );

  return dedupeLookupCandidates(results.flat());
}

/**
 * Removes duplicate provider candidate rows while preserving stable provider order for the UI.
 */
function dedupeLookupCandidates(candidates: ProviderLookupCandidateBase[]): ProviderLookupCandidateBase[] {
  const seenKeys = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.providerId}:${candidate.providerPartKey}`;

    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
}
