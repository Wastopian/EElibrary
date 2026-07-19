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
 * Queries every registered provider adapter but tolerates individual failures, so one provider outage
 * (for example expired distributor credentials) cannot hide answers from the providers that worked.
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
