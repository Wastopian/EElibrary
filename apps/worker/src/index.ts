/**
 * File header: Runs worker status and provider ingestion commands.
 */

import { performance } from "node:perf_hooks";
import { providerAdapters } from "./provider-adapters";
import { DEFAULT_HEARTBEAT_INTERVAL_MS, emitHeartbeat, resolveWorkerId, shutdownHeartbeatPool } from "./heartbeat";
import { assertDatabaseReady, listProviderImportDiagnostics, listWorkerOperationalDiagnostics, recomputeReadinessForAllParts } from "./catalog-repository";
import { generateDraftAssetsFromDatabase } from "./draft-generation";
import { bulkEnqueueProviderAcquisitionJobs, processProviderAcquisitionJobs } from "./provider-acquisition-jobs";
import { processProviderEnrichmentJobs } from "./provider-enrichment-jobs";
import { processPendingExportBundleAssembly } from "./export-bundle-assembly";
import { getWorkerStorageClient } from "./file-storage";
import { runProviderPartImport } from "./provider-part-import";
import { refreshStaleSupplyOfferSnapshots } from "./supply-offer-refresh";
import { countJlcCategories, enumerateJlcPartRequests } from "./providers/jlcparts-provider";
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
 * Bulk-enqueues all parts from the JLC catalog into the acquisition job queue.
 * Fetches the provider index, streams every category payload, and inserts one
 * acquisition job per LCSC code — skipping parts already in the catalog or already queued.
 */
async function enqueueCatalog(): Promise<void> {
  const timings: WorkerTiming[] = [];

  await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

  const categoryCount = await timeWorkerOperation(
    "jlcparts.count_categories",
    () => countJlcCategories(),
    timings,
    (n) => `${n} categories`
  );

  process.stderr.write(JSON.stringify({ stage: "enqueue_start", totalCategories: categoryCount }) + "\n");

  const summary = await timeWorkerOperation(
    "worker.bulk_enqueue",
    () =>
      bulkEnqueueProviderAcquisitionJobs("jlcparts", enumerateJlcPartRequests(), "system:bulk_catalog_enqueue", (progress) => {
        process.stderr.write(JSON.stringify({ stage: "category_done", ...progress }) + "\n");
      }),
    timings,
    (s) => `${s.totalEnqueued} enqueued, ${s.totalSkipped} skipped`
  );

  console.log(JSON.stringify({ ...summary, timings }, null, 2));
}

/**
 * Continuously processes queued provider acquisition jobs in batches until the queue is empty.
 * Pass concurrency as the second CLI arg to override the default of 5 concurrent jobs per batch.
 */
async function drainProviderAcquisitionJobs(batchSizeValue?: string, concurrencyValue?: string): Promise<void> {
  const batchSize = batchSizeValue ? Number(batchSizeValue) : 20;
  const concurrency = concurrencyValue ? Number(concurrencyValue) : 5;
  const boundedBatchSize = Number.isFinite(batchSize) ? Math.max(1, Math.min(batchSize, 100)) : 20;
  const boundedConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.min(concurrency, 20)) : 5;
  const timings: WorkerTiming[] = [];
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let batchNumber = 0;

  await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

  for (;;) {
    const summary = await processProviderAcquisitionJobs(boundedBatchSize, boundedConcurrency);

    if (summary.processed.length === 0) {
      break;
    }

    batchNumber += 1;
    const batchSucceeded = summary.processed.filter((r) => r.status === "succeeded").length;
    const batchFailed = summary.processed.filter((r) => r.status === "failed").length;
    totalProcessed += summary.processed.length;
    totalSucceeded += batchSucceeded;
    totalFailed += batchFailed;

    process.stderr.write(
      JSON.stringify({ batch: batchNumber, batchProcessed: summary.processed.length, batchSucceeded, batchFailed, totalProcessed, totalSucceeded, totalFailed }) + "\n"
    );
  }

  console.log(JSON.stringify({ totalProcessed, totalSucceeded, totalFailed, batches: batchNumber, timings }, null, 2));
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
    "npm run acquisition-jobs -w @ee-library/worker -- [limit]",
    "npm run enrichment-jobs -w @ee-library/worker -- [limit]",
    "npm run assemble-bundles -w @ee-library/worker -- [limit]",
    "npm run refresh-supply-offers -w @ee-library/worker -- [limit]",
    "npm run enqueue-catalog -w @ee-library/worker",
    "npm run drain-acquisition-jobs -w @ee-library/worker -- [batchSize]",
    "npm run generate:drafts -w @ee-library/worker -- [limit]",
    "npm run recompute:readiness -w @ee-library/worker -- [--batch-size N] [--since ISO_DATE]",
    `providerId values: ${providerIds}`
  ];
}

/**
 * Bulk-recomputes readiness projections for all parts, or for parts updated since a given date.
 */
async function recomputeReadiness(args: string[]): Promise<void> {
  const batchSizeValue = parseNamedArg(args, "batch-size");
  const since = parseNamedArg(args, "since");
  const parsedBatchSize = batchSizeValue ? Number(batchSizeValue) : NaN;
  const batchSize = Number.isFinite(parsedBatchSize) ? Math.max(1, Math.min(parsedBatchSize, 500)) : 50;
  const timings: WorkerTiming[] = [];

  await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

  process.stderr.write(JSON.stringify({ stage: "recompute_start", batchSize, since: since ?? null }) + "\n");

  const summary = await timeWorkerOperation(
    "worker.recompute_readiness",
    () =>
      recomputeReadinessForAllParts(batchSize, since, (progress) => {
        process.stderr.write(JSON.stringify({ stage: "batch_done", ...progress }) + "\n");
      }),
    timings,
    (s) => `${s.succeededCount} succeeded, ${s.failedCount} failed`
  );

  console.log(JSON.stringify({ ...summary, timings }, null, 2));
}

/**
 * Reads a named CLI argument of the form --name value from an args array.
 */
function parseNamedArg(args: string[], name: string): string | undefined {
  const flag = `--${name}`;

  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag) {
      return args[i + 1];
    }
  }

  return undefined;
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
 * Processes queued provider acquisition jobs through the shared provider import runner.
 */
async function processQueuedProviderAcquisitionJobs(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const summary = await timeWorkerOperation(
      "worker.process_provider_acquisition_jobs",
      () => processProviderAcquisitionJobs(Number.isFinite(limit) ? limit : 20),
      timings,
      (value) => `${value.processed.length} jobs`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.process_provider_acquisition_jobs", error, timings);
    throw error;
  }
}

/**
 * Processes queued provider enrichment jobs through the background enrichment worker.
 */
async function processQueuedProviderEnrichmentJobs(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const summary = await timeWorkerOperation(
      "worker.process_provider_enrichment_jobs",
      () => processProviderEnrichmentJobs(Number.isFinite(limit) ? limit : 20),
      timings,
      (value) => `${value.processed.length} jobs`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.process_provider_enrichment_jobs", error, timings);
    throw error;
  }
}

/**
 * Drains pending export bundles by copying each verified asset's bytes into the per-bundle storage prefix.
 *
 * Failures are persisted as structured `assembly_error` telemetry on the bundle row so operators see
 * exactly which asset failed and why instead of a generic "bundle generation failed" line.
 */
async function assembleExportBundles(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const storage = getWorkerStorageClient();
    const summary = await timeWorkerOperation(
      "worker.assemble_export_bundles",
      () => processPendingExportBundleAssembly(Number.isFinite(limit) ? limit : 20, storage),
      timings,
      (value) => `${value.processed.length} bundle${value.processed.length === 1 ? "" : "s"}, ${value.processed.filter((r) => r.status === "assembly_failed").length} failed`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.assemble_export_bundles", error, timings);
    throw error;
  }
}

/**
 * Refreshes stale active supply-offer snapshots by re-running exact provider imports.
 */
async function refreshSupplyOffers(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const summary = await timeWorkerOperation(
      "worker.refresh_supply_offers",
      () => refreshStaleSupplyOfferSnapshots({ limit: Number.isFinite(limit) ? limit : 20 }),
      timings,
      (value) => `${value.refreshedCount} refreshed, ${value.failedCount} failed, ${value.skippedCount} skipped`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.refresh_supply_offers", error, timings);
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

  if (command === "acquisition-jobs") {
    await processQueuedProviderAcquisitionJobs(process.argv[3]);
    return;
  }

  if (command === "enrichment-jobs") {
    await processQueuedProviderEnrichmentJobs(process.argv[3]);
    return;
  }

  if (command === "assemble-bundles") {
    await assembleExportBundles(process.argv[3]);
    return;
  }

  if (command === "refresh-supply-offers") {
    await refreshSupplyOffers(process.argv[3]);
    return;
  }

  if (command === "generate-drafts") {
    await generateDraftAssets(process.argv[3]);
    return;
  }

  if (command === "enqueue-catalog") {
    await enqueueCatalog();
    return;
  }

  if (command === "drain-acquisition-jobs") {
    await drainProviderAcquisitionJobs(process.argv[3], process.argv[4]);
    return;
  }

  if (command === "recompute-readiness") {
    await recomputeReadiness(process.argv.slice(3));
    return;
  }

  if (command === "heartbeat") {
    try {
      await safeEmitHeartbeat({ command: "heartbeat" });
      console.log(`Emitted heartbeat for worker ${resolveWorkerId()}`);
    } finally {
      await shutdownHeartbeatPool();
    }
    return;
  }

  if (command === "daemon") {
    await runDaemon();
    return;
  }

  throw new Error(`Unknown worker command: ${command}\n\n${buildUsageLines().join("\n")}`);
}

/**
 * DEFAULT_BUNDLE_ASSEMBLY_INTERVAL_MS controls how often the daemon drains pending export bundle
 * assemblies. Slower than the heartbeat interval so the daemon does not hammer Postgres when no
 * bundles are queued; the cadence is fine because bundle generation is operator-initiated and
 * a 30 second tail-latency between "Generate" and "Download archive" is acceptable.
 */
const DEFAULT_BUNDLE_ASSEMBLY_INTERVAL_MS = 30_000;

/**
 * DEFAULT_BUNDLE_ASSEMBLY_BATCH_LIMIT caps how many pending bundles one tick processes so a long
 * backlog does not block heartbeats or other daemon work.
 */
const DEFAULT_BUNDLE_ASSEMBLY_BATCH_LIMIT = 5;

/**
 * DEFAULT_SUPPLY_OFFER_REFRESH_INTERVAL_MS controls how often the daemon asks providers to
 * refresh stale active commercial snapshots. The cadence is deliberately slower than bundle
 * assembly because provider refresh may perform network calls.
 */
const DEFAULT_SUPPLY_OFFER_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * DEFAULT_SUPPLY_OFFER_REFRESH_BATCH_LIMIT caps provider refreshes per daemon tick so one stale
 * commercial backlog cannot starve heartbeats or bundle assembly.
 */
const DEFAULT_SUPPLY_OFFER_REFRESH_BATCH_LIMIT = 5;

/**
 * Runs the worker daemon: emits a heartbeat on a periodic interval until SIGINT/SIGTERM, drains
 * pending export-bundle asset-byte assemblies, and refreshes stale active supply-offer snapshots.
 *
 * Used by the local-dev `npm run dev:worker` script and the GET /system/health liveness check.
 */
async function runDaemon(): Promise<void> {
  console.log(
    `Worker daemon starting (workerId=${resolveWorkerId()}, heartbeat=${DEFAULT_HEARTBEAT_INTERVAL_MS}ms, bundleAssembly=${DEFAULT_BUNDLE_ASSEMBLY_INTERVAL_MS}ms, supplyOfferRefresh=${DEFAULT_SUPPLY_OFFER_REFRESH_INTERVAL_MS}ms).`
  );

  await safeEmitHeartbeat({ command: "daemon" });

  const heartbeatInterval = setInterval(() => {
    void safeEmitHeartbeat({ command: "daemon" });
  }, DEFAULT_HEARTBEAT_INTERVAL_MS);

  const bundleAssemblyInterval = setInterval(() => {
    void safeProcessPendingExportBundleAssembly();
  }, DEFAULT_BUNDLE_ASSEMBLY_INTERVAL_MS);

  const supplyOfferRefreshInterval = setInterval(() => {
    void safeRefreshStaleSupplyOffers();
  }, DEFAULT_SUPPLY_OFFER_REFRESH_INTERVAL_MS);

  // Run one assembly pass right after startup so a bundle queued while the daemon was offline does
  // not have to wait a full interval before the worker picks it up.
  void safeProcessPendingExportBundleAssembly();
  void safeRefreshStaleSupplyOffers();

  await new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(heartbeatInterval);
      clearInterval(bundleAssemblyInterval);
      clearInterval(supplyOfferRefreshInterval);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  console.log("Worker daemon stopping.");
  await shutdownHeartbeatPool();
}

/**
 * Processes pending export bundle assemblies without throwing so a transient DB or storage error
 * never crashes the daemon. Logs a one-line summary only when there was actual work to surface so
 * an idle daemon stays quiet.
 */
async function safeProcessPendingExportBundleAssembly(): Promise<void> {
  try {
    const storage = getWorkerStorageClient();
    const summary = await processPendingExportBundleAssembly(DEFAULT_BUNDLE_ASSEMBLY_BATCH_LIMIT, storage);

    if (summary.processed.length === 0) {
      return;
    }

    const failed = summary.processed.filter((row) => row.status === "assembly_failed").length;
    const assembled = summary.processed.length - failed;
    console.log(
      `Worker daemon: assembled ${assembled} bundle${assembled === 1 ? "" : "s"}` +
        (failed > 0 ? `, ${failed} failed (see assembly_error JSONB)` : "")
    );
  } catch (error) {
    console.error("Bundle assembly tick failed.", error instanceof Error ? error.message : error);
  }
}

/**
 * Refreshes stale supply-offer snapshots without crashing the daemon on provider or DB failures.
 * Logs only when the tick selected work so idle systems stay quiet.
 */
async function safeRefreshStaleSupplyOffers(): Promise<void> {
  try {
    const summary = await refreshStaleSupplyOfferSnapshots({ limit: DEFAULT_SUPPLY_OFFER_REFRESH_BATCH_LIMIT });

    if (summary.checkedCount === 0) {
      return;
    }

    console.log(
      `Worker daemon: refreshed ${summary.refreshedCount} stale supply source${summary.refreshedCount === 1 ? "" : "s"}` +
        (summary.failedCount > 0 ? `, ${summary.failedCount} failed` : "") +
        (summary.skippedCount > 0 ? `, ${summary.skippedCount} skipped` : "")
    );
  } catch (error) {
    console.error("Supply-offer refresh tick failed.", error instanceof Error ? error.message : error);
  }
}

/**
 * Emits a heartbeat without throwing so transient DB errors do not crash the daemon.
 */
async function safeEmitHeartbeat(details: Record<string, unknown>): Promise<void> {
  try {
    await emitHeartbeat(details);
  } catch (error) {
    console.error("Heartbeat emit failed.", error instanceof Error ? error.message : error);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
