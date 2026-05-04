/**
 * File header: Indirection so API tests can stub provider lookup without hitting real provider adapters.
 */

import { runProviderPartLookup as defaultRunProviderPartLookup, type ProviderExactLookupRequest } from "@ee-library/worker/provider-part-lookup";
import type { ProviderLookupCandidateBase } from "@ee-library/shared/types";

type RunProviderPartLookup = (request: ProviderExactLookupRequest) => Promise<ProviderLookupCandidateBase[]>;

let runProviderPartLookupImpl: RunProviderPartLookup = defaultRunProviderPartLookup;

/**
 * Runs one explicit exact-match provider lookup using the shared worker implementation or a test override.
 */
export function runProviderPartLookup(request: ProviderExactLookupRequest): Promise<ProviderLookupCandidateBase[]> {
  return runProviderPartLookupImpl(request);
}

/**
 * Overrides provider lookup for API route tests; pass null to restore the default worker runner.
 */
export function setProviderPartLookupRunnerForTests(next: RunProviderPartLookup | null): void {
  runProviderPartLookupImpl = next ?? defaultRunProviderPartLookup;
}
