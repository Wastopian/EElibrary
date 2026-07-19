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

/** ProviderLookupSettledResult separates answering providers' candidates from providers that errored. */
export interface ProviderLookupSettledResult {
  /** Exact candidates from every provider that answered, in registry order. */
  candidates: ProviderLookupCandidateBase[];
  /** Providers that threw (network outage, expired credentials) rather than answering not-found. */
  failures: Array<{ providerId: string; message: string }>;
}

/**
 * Like runProviderPartLookup, but one provider's outage never hides the others' answers: rejections
 * are collected per provider instead of failing the whole fan-out. Callers that must distinguish
 * "every provider answered and none had it" from "a provider did not answer" (e.g. the BOM backfill
 * queue, whose no_match claim must stay honest) use this variant.
 */
export async function runProviderPartLookupSettled(request: ProviderExactLookupRequest): Promise<ProviderLookupSettledResult> {
  const settled = await Promise.allSettled(
    providerAdapters.map((adapter) => adapter.findExactPartCandidates(request))
  );
  const candidates: ProviderLookupCandidateBase[] = [];
  const failures: Array<{ providerId: string; message: string }> = [];

  settled.forEach((result, index) => {
    const providerId = providerAdapters[index]?.id ?? "unknown";

    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else {
      const reason = result.reason;
      failures.push({
        message: reason instanceof Error ? reason.message : String(reason),
        providerId
      });
    }
  });

  return { candidates: dedupeLookupCandidates(candidates), failures };
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
