/**
 * File header: Runs explicit exact-match provider candidate lookup without persisting any catalog rows.
 */

import { providerAdapters } from "./provider-adapters";
import type { ProviderAdapter, ProviderExactLookupRequest } from "./provider-adapters";
import type { ProviderLookupCandidateBase } from "@ee-library/shared/types";

export type { ProviderExactLookupRequest } from "./provider-adapters";

/** ProviderPartLookupFailure captures one provider adapter that failed during the exact-lookup fan-out. */
export interface ProviderPartLookupFailure {
  /** Registered adapter id, such as digikey. */
  providerId: string;
  /** Display-ready adapter name for logs and user-facing failure mapping. */
  providerName: string;
  /** Raw adapter failure text; API surfaces map this to calm user-facing wording before display. */
  message: string;
}

/** SettledProviderPartLookup pairs candidates from adapters that answered with per-adapter failures. */
export interface SettledProviderPartLookup {
  /** Deduplicated candidates from every adapter that answered, in adapter registry order. */
  candidates: ProviderLookupCandidateBase[];
  /** Adapters that threw during the fan-out; empty means every adapter answered. */
  failures: ProviderPartLookupFailure[];
}

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
 * Queries every registered provider adapter but tolerates individual failures, so one provider outage
 * (for example expired distributor credentials) cannot hide answers from the providers that worked.
 * Callers that must distinguish "every provider answered and none had it" from "a provider did not
 * answer" (the interactive lookup route and the BOM backfill queue, whose no_match claim must stay
 * honest) use this instead of runProviderPartLookup.
 */
export async function runProviderPartLookupSettled(
  request: ProviderExactLookupRequest,
  adapters: ProviderAdapter[] = providerAdapters
): Promise<SettledProviderPartLookup> {
  const settled = await Promise.allSettled(
    adapters.map((adapter) => adapter.findExactPartCandidates(request))
  );
  const candidates: ProviderLookupCandidateBase[] = [];
  const failures: ProviderPartLookupFailure[] = [];

  settled.forEach((result, index) => {
    const adapter = adapters[index];

    if (!adapter) {
      return;
    }

    if (result.status === "fulfilled") {
      candidates.push(...result.value);
      return;
    }

    failures.push({
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      providerId: adapter.id,
      providerName: adapter.name
    });
  });

  return {
    candidates: dedupeLookupCandidates(candidates),
    failures
  };
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
