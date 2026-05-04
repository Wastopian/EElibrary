/**
 * File header: Indirection so API tests can stub provider import without running adapters.
 */

import { runProviderPartImport as defaultRunProviderPartImport, type ImportResultSummary, type ProviderPartRequest } from "@ee-library/worker/provider-part-import";

type RunProviderPartImport = (adapterId: string, request: ProviderPartRequest) => Promise<ImportResultSummary>;

let runProviderPartImportImpl: RunProviderPartImport = defaultRunProviderPartImport;

/**
 * Runs one provider import using the shared worker implementation or a test override.
 */
export function runProviderPartImport(adapterId: string, request: ProviderPartRequest): Promise<ImportResultSummary> {
  return runProviderPartImportImpl(adapterId, request);
}

/**
 * Overrides provider import for API route tests; pass null to restore the default worker runner.
 */
export function setProviderImportRunnerForTests(next: RunProviderPartImport | null): void {
  runProviderPartImportImpl = next ?? defaultRunProviderPartImport;
}
