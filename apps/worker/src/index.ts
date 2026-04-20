/**
 * File header: Runs worker status and provider ingestion commands.
 */

import { performance } from "node:perf_hooks";
import { providerAdapters } from "./provider-adapters";
import { assertDatabaseReady, listProviderImportDiagnostics, listWorkerOperationalDiagnostics } from "./catalog-repository";
import { generateDraftAssetsFromDatabase } from "./draft-generation";
import { runProviderPartImport } from "./provider-part-import";
import type { ProviderPartRequest } from "./provider-adapters";
import type { ProviderImportDiagnostic, SourceImportStatus } from "@ee-library/shared/types";
import type { ImportResultSummary, WorkerTiming } from "./provider-part-import";

/** IngestionStage names the future worker stages documented in docs/DATA_MODEL.md. */
type IngestionStage =
  | "fetch_raw_source_payload"
  | "parse_adapter_contract"
  | "normalize_fields_and_units"
  | "validate_files_and_metadata"
  | "publish_searchable_record";

/** WorkerStatus is a truthful startup payload for the current skeleton. */
interface WorkerStatus {
  /** Service name for logs and process supervision. */
  service: "worker";
  /** Queue state stays explicit until Redis is wired in a later phase. */
  queue: "not_connected_phase_0";
  /** Planned deterministic ingestion stages from the data model. */
  plannedStages: IngestionStage[];
  /** Registered provider adapter count. */
  registeredProviderAdapters: number;
  /** Registered provider adapter identifiers. */
  providerAdapterIds: string[];
  /** Short command usage for local operation. */
  usage: string[];
}

/** plannedStages mirrors the ingestion flow without doing provider work. */
const plannedStages: IngestionStage[] = [
  "fetch_raw_source_payload",
  "parse_adapter_contract",
  "normalize_fields_and_units",
  "validate_files_and_metadata",
  "publish_searchable_record"
];

/**
 * Builds the startup status object for the worker skeleton.
 */
function getWorkerStatus(): WorkerStatus {
  return {
    plannedStages,
    providerAdapterIds: providerAdapters.map((adapter) => adapter.id),
    queue: "not_connected_phase_0",
    registeredProviderAdapters: providerAdapters.length,
    service: "worker",
    usage: buildUsageLines()
  };
}

/**
 * Ingests all locally available requests from one provider adapter into Postgres.
 */
async function ingestAvailableProviderRequests(adapterId: string): Promise<void> {
  const adapter = providerAdapters.find((candidate) => candidate.id === adapterId);

  if (!adapter) {
    throw new Error(`Provider adapter not registered: ${adapterId}`);
  }

  const summaries: ImportResultSummary[] = [];
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const requests = await timeWorkerOperation("provider.list_available_requests", () => adapter.listAvailablePartRequests(), timings, (value) => `${value.length} requests`);

    for (const request of requests) {
      summaries.push(await runProviderPartImport(adapter.id, request));
    }

    console.log(JSON.stringify({ imported: summaries.length, imports: summaries, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.ingest_available_provider_requests", error, timings);
    throw error;
  }
}

/**
 * Ingests a single provider lookup request into Postgres.
 */
async function ingestProviderPart(adapterId: string, request: ProviderPartRequest): Promise<void> {
  const timings: WorkerTiming[] = [];

  try {
    const summary = await runProviderPartImport(adapterId, request);

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    logWorkerFailure("worker.ingest_provider_part", error, timings);
    throw error;
  }
}

/**
 * Builds concise command usage lines from the registered provider adapters.
 */
function buildUsageLines(): string[] {
  const providerIds = providerAdapters.map((adapter) => adapter.id).join(", ");

  return [
    "npm run dev:worker",
    "npm run ingest:local",
    "npm run ingest -w @ee-library/worker -- <providerId> <MPN> [manufacturerName]",
    "npm run ingest -w @ee-library/worker -- <providerId>",
    "npm run imports -w @ee-library/worker -- [failed]",
    "npm run operations -w @ee-library/worker -- [limit]",
    "npm run generate:drafts -w @ee-library/worker -- [limit]",
    `providerId values: ${providerIds}`
  ];
}

/**
 * Prints recent provider import diagnostics for local admin/debug use.
 */
async function printProviderImportDiagnostics(status?: SourceImportStatus): Promise<void> {
  const timings: WorkerTiming[] = [];

  await assertDatabaseReady();

  const diagnostics = await timeWorkerOperation("repository.list_provider_import_diagnostics", () => listProviderImportDiagnostics(20, status), timings, (value) => `${value.length} imports`);

  console.log(JSON.stringify({ ...summarizeImportDiagnostics(diagnostics), timings }, null, 2));
}

/**
 * Generates review-required draft CAD assets from pending DB-backed requests.
 */
async function generateDraftAssets(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const summary = await timeWorkerOperation("worker.generate_draft_assets", () => generateDraftAssetsFromDatabase(Number.isFinite(limit) ? limit : 20), timings, (value) => `${value.generated.length} generated, ${value.skipped.length} skipped`);

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.generate_draft_assets", error, timings);
    throw error;
  }
}

/**
 * Prints recent imports, generation, review, validation, and promotion diagnostics.
 */
async function printWorkerOperationalDiagnostics(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const diagnostics = await timeWorkerOperation("repository.list_operational_diagnostics", () => listWorkerOperationalDiagnostics(Number.isFinite(limit) ? limit : 20), timings, (value) => `${value.recentImports.length} imports, ${value.recentGenerationRuns.length} generation runs`);

    console.log(JSON.stringify({ ...diagnostics, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.operational_diagnostics", error, timings);
    throw error;
  }
}

/**
 * Builds a compact import diagnostics summary without hiding individual failures.
 */
function summarizeImportDiagnostics(diagnostics: ProviderImportDiagnostic[]) {
  return {
    failed: diagnostics.filter((diagnostic) => diagnostic.importStatus === "failed").length,
    imports: diagnostics,
    total: diagnostics.length
  };
}

/**
 * Converts unknown errors into a short CLI-safe diagnostic string.
 */
function formatUnknownError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Prints failure timing payloads before the top-level command exits nonzero.
 */
function logWorkerFailure(operation: string, error: unknown, timings: WorkerTiming[]): void {
  console.error(JSON.stringify({ error: formatUnknownError(error), operation, timings }, null, 2));
}

/**
 * Measures an asynchronous worker operation and appends a timing record.
 */
async function timeWorkerOperation<TValue>(name: string, operation: () => Promise<TValue>, timings: WorkerTiming[], describe?: (value: TValue) => string): Promise<TValue> {
  const startedAt = performance.now();

  try {
    const value = await operation();

    const detail = describe?.(value);

    timings.push({ durationMs: roundDuration(performance.now() - startedAt), name, ...(detail !== undefined ? { detail } : {}) });

    return value;
  } catch (error) {
    timings.push({ detail: "failed", durationMs: roundDuration(performance.now() - startedAt), name });
    throw error;
  }
}

/**
 * Rounds timings for stable local CLI output.
 */
function roundDuration(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Runs the requested worker command.
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";

  if (command === "help") {
    console.log(buildUsageLines().join("\n"));
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(getWorkerStatus(), null, 2));
    return;
  }

  if (command === "ingest") {
    const adapterId = process.argv[3] ?? "local-catalog";
    const mpn = process.argv[4];
    const manufacturerName = process.argv[5];

    if (mpn) {
      await ingestProviderPart(adapterId, manufacturerName ? { manufacturerName, mpn } : { mpn });
      return;
    }

    await ingestAvailableProviderRequests(adapterId);
    return;
  }

  if (command === "imports") {
    const status = process.argv[3] === "failed" ? "failed" : undefined;

    await printProviderImportDiagnostics(status);
    return;
  }

  if (command === "operations") {
    await printWorkerOperationalDiagnostics(process.argv[3]);
    return;
  }

  if (command === "generate-drafts") {
    await generateDraftAssets(process.argv[3]);
    return;
  }

  throw new Error(`Unknown worker command: ${command}\n\n${buildUsageLines().join("\n")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
