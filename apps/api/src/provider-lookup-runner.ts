/**
 * File header: Indirection so API tests can stub provider lookup without hitting real provider adapters.
 */

import { runProviderPartLookupSettled as defaultRunProviderPartLookupSettled, type ProviderExactLookupRequest, type SettledProviderPartLookup } from "@ee-library/worker/provider-part-lookup";

type RunProviderPartLookupSettled = (request: ProviderExactLookupRequest) => Promise<SettledProviderPartLookup>;

let runProviderPartLookupImpl: RunProviderPartLookupSettled = defaultRunProviderPartLookupSettled;

/**
 * Runs one explicit exact-match provider lookup that tolerates per-provider failures, using the shared worker implementation or a test override.
 */
export function runProviderPartLookupSettled(request: ProviderExactLookupRequest): Promise<SettledProviderPartLookup> {
  return runProviderPartLookupImpl(request);
}

/**
 * Overrides provider lookup for API route tests; pass null to restore the default worker runner.
 */
export function setProviderPartLookupRunnerForTests(next: RunProviderPartLookupSettled | null): void {
  runProviderPartLookupImpl = next ?? defaultRunProviderPartLookupSettled;
}
