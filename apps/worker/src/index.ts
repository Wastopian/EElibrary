/**
 * File header: Runs worker status and provider ingestion commands.
 */

import { performance } from "node:perf_hooks";
import { providerAdapters } from "./provider-adapters";
import { DEFAULT_HEARTBEAT_INTERVAL_MS, emitHeartbeat, resolveWorkerId, shutdownHeartbeatPool } from "./heartbeat";
import { assertDatabaseReady, listProviderImportDiagnostics, listWorkerOperationalDiagnostics, recomputeReadinessForAllParts, replayLocalCatalogCrossPartRelations } from "./catalog-repository";
import { generateDraftAssetsFromDatabase } from "./draft-generation";
import { bulkEnqueueProviderAcquisitionJobs, processProviderAcquisitionJobs } from "./provider-acquisition-jobs";
import { processBomBackfillRequests } from "./bom-backfill-jobs";
import { enqueueProviderEnrichmentJobsForPart, processProviderEnrichmentJobs } from "./provider-enrichment-jobs";
import { processPendingExportBundleAssembly } from "./export-bundle-assembly";
import { getWorkerStorageClient } from "./file-storage";
import { buildThreeDPreviewConverterFromEnv, processPendingThreeDPreviewJobs, setThreeDPreviewConverter } from "./three-d-preview";
import { processFootprintGeometryValidations, processSymbolPinCountValidations, processThreeDGeometryValidations } from "./asset-validation-jobs";
import { processProjectDocumentExtractionJobs } from "./project-document-extraction";
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

    if (adapterId === "local-catalog") {
      await timeWorkerOperation("repository.replay_local_catalog_cross_part_relations", () => replayLocalCatalogCrossPartRelations(adapter), timings);
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

    // The CLI persists directly (no acquisition job), so enqueue enrichment here — matching what the API
    // acquisition-success path does — so datasheet capture/extraction run on the next enrichment pass.
    // Enqueue is best-effort: a failure here must not fail an otherwise-successful import.
    try {
      await enqueueProviderEnrichmentJobsForPart({
        partId: summary.partId,
        requestedAt: new Date().toISOString(),
        requestedBy: "cli:ingest",
        sourceAcquisitionJobId: null
      });
    } catch (enqueueError) {
      console.error(`worker.ingest_provider_part: enrichment enqueue failed (import still succeeded): ${String(enqueueError)}`);
    }
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
    "npm run bom-backfill -w @ee-library/worker -- [limit]",
    "npm run enrichment-jobs -w @ee-library/worker -- [limit]",
    "npm run assemble-bundles -w @ee-library/worker -- [limit]",
    "npm run generate-three-d-previews -w @ee-library/worker -- [limit]",
    "npm run validate-footprints -w @ee-library/worker -- [limit]",
    "npm run validate-symbol-pin-counts -w @ee-library/worker -- [limit]",
    "npm run validate-three-d-models -w @ee-library/worker -- [limit]",
    "npm run extract-project-documents -w @ee-library/worker -- [limit]",
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
 * Processes queued BOM backfill requests: exact provider lookup, then import or an honest park.
 */
async function processQueuedBomBackfillRequests(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 10;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const summary = await timeWorkerOperation(
      "worker.process_bom_backfill_requests",
      () => processBomBackfillRequests(Number.isFinite(limit) ? limit : 10),
      timings,
      (value) => `${value.processed.length} requests`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.process_bom_backfill_requests", error, timings);
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
 * Processes queued project PDF and Office extraction jobs.
 */
async function extractProjectDocuments(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 5;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);
    const summary = await timeWorkerOperation(
      "worker.extract_project_documents",
      () => processProjectDocumentExtractionJobs(Number.isFinite(limit) ? limit : 5),
      timings,
      (value) => `${value.processed.length} documents`
    );
    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.extract_project_documents", error, timings);
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
 * Generates derived 3D preview artifacts (glTF/glb) for stored STEP assets.
 *
 * Honest skip path: when no converter is configured (`EE_LIBRARY_STEP_TO_GLTF_CMD` unset), each
 * candidate is reported as `skipped_converter_unavailable` so an operator immediately sees the
 * "no converter wired" state instead of believing previews are being silently produced.
 */
async function generateThreeDPreviews(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const converter = buildThreeDPreviewConverterFromEnv();
    setThreeDPreviewConverter(converter);
    const storage = getWorkerStorageClient();

    const summary = await timeWorkerOperation(
      "worker.generate_three_d_previews",
      () => processPendingThreeDPreviewJobs(Number.isFinite(limit) ? limit : 20, storage),
      timings,
      (value) => `${value.processed.length} candidate${value.processed.length === 1 ? "" : "s"}, ${value.processed.filter((row) => row.status === "converted").length} converted, ${value.processed.filter((row) => row.status === "conversion_failed").length} failed, ${value.processed.filter((row) => row.status === "skipped_converter_unavailable").length} skipped (no converter)`
    );

    console.log(JSON.stringify({ converterConfigured: converter !== null, ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.generate_three_d_previews", error, timings);
    throw error;
  }
}

/**
 * Runs the file-grounded footprint geometry validator over a bounded batch of stored
 * footprint assets. Each candidate produces an `asset_validation_records` row tagged
 * `generated:footprint_geometry_v1`; the asset's review/export status is never moved.
 */
async function runFootprintGeometryValidationCommand(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const storage = getWorkerStorageClient();
    const summary = await timeWorkerOperation(
      "worker.validate_footprint_geometry",
      () => processFootprintGeometryValidations(Number.isFinite(limit) ? limit : 20, storage),
      timings,
      (value) =>
        `${value.processed.length} candidate${value.processed.length === 1 ? "" : "s"}, ` +
        `${value.processed.filter((row) => row.recordedStatus === "verified").length} verified, ` +
        `${value.processed.filter((row) => row.recordedStatus === "needs_review").length} needs_review, ` +
        `${value.processed.filter((row) => row.recordedStatus === "failed").length} failed`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.validate_footprint_geometry", error, timings);
    throw error;
  }
}

/**
 * Runs the file-grounded symbol pin-count cross-check validator over a bounded batch of
 * stored symbol assets. Each candidate produces an `asset_validation_records` row tagged
 * `generated:symbol_pin_mapping_v1`; the asset's review/export status is never moved.
 */
async function runSymbolPinCountValidationCommand(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const storage = getWorkerStorageClient();
    const summary = await timeWorkerOperation(
      "worker.validate_symbol_pin_counts",
      () => processSymbolPinCountValidations(Number.isFinite(limit) ? limit : 20, storage),
      timings,
      (value) =>
        `${value.processed.length} candidate${value.processed.length === 1 ? "" : "s"}, ` +
        `${value.processed.filter((row) => row.recordedStatus === "verified").length} verified, ` +
        `${value.processed.filter((row) => row.recordedStatus === "needs_review").length} needs_review, ` +
        `${value.processed.filter((row) => row.recordedStatus === "failed").length} failed`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.validate_symbol_pin_counts", error, timings);
    throw error;
  }
}

/**
 * Runs the file-grounded STEP integrity validator over a bounded batch of stored 3D-model
 * assets. Each candidate produces an `asset_validation_records` row tagged
 * `generated:step_integrity_v1`; the asset's review/export status is never moved.
 */
async function runThreeDGeometryValidationCommand(limitValue?: string): Promise<void> {
  const limit = limitValue ? Number(limitValue) : 20;
  const timings: WorkerTiming[] = [];

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const storage = getWorkerStorageClient();
    const summary = await timeWorkerOperation(
      "worker.validate_three_d_geometry",
      () => processThreeDGeometryValidations(Number.isFinite(limit) ? limit : 20, storage),
      timings,
      (value) =>
        `${value.processed.length} candidate${value.processed.length === 1 ? "" : "s"}, ` +
        `${value.processed.filter((row) => row.recordedStatus === "verified").length} verified, ` +
        `${value.processed.filter((row) => row.recordedStatus === "needs_review").length} needs_review, ` +
        `${value.processed.filter((row) => row.recordedStatus === "failed").length} failed`
    );

    console.log(JSON.stringify({ ...summary, timings }, null, 2));
  } catch (error) {
    logWorkerFailure("worker.validate_three_d_geometry", error, timings);
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

  if (command === "bom-backfill") {
    await processQueuedBomBackfillRequests(process.argv[3]);
    return;
  }

  if (command === "assemble-bundles") {
    await assembleExportBundles(process.argv[3]);
    return;
  }

  if (command === "generate-three-d-previews") {
    await generateThreeDPreviews(process.argv[3]);
    return;
  }

  if (command === "validate-footprints") {
    await runFootprintGeometryValidationCommand(process.argv[3]);
    return;
  }

  if (command === "validate-symbol-pin-counts") {
    await runSymbolPinCountValidationCommand(process.argv[3]);
    return;
  }

  if (command === "validate-three-d-models") {
    await runThreeDGeometryValidationCommand(process.argv[3]);
    return;
  }

  if (command === "extract-project-documents") {
    await extractProjectDocuments(process.argv[3]);
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
 * DEFAULT_THREE_D_PREVIEW_INTERVAL_MS controls how often the daemon attempts STEP→glTF
 * conversion. The cadence is similar to bundle assembly so a freshly downloaded STEP becomes
 * visually previewable within a minute, but slower than the heartbeat to leave room for the
 * (potentially expensive) converter to run without blocking liveness reporting.
 */
const DEFAULT_THREE_D_PREVIEW_INTERVAL_MS = 60_000;

/**
 * DEFAULT_THREE_D_PREVIEW_BATCH_LIMIT caps how many STEP assets one tick processes so a long
 * preview backlog cannot starve heartbeats or bundle assembly.
 */
const DEFAULT_THREE_D_PREVIEW_BATCH_LIMIT = 3;

/**
 * DEFAULT_ASSET_VALIDATION_INTERVAL_MS controls how often the daemon runs the file-grounded
 * asset validators (footprint geometry + symbol pin-count cross-check). Slower than 3D preview
 * because the validators are cheap-but-useless to re-run constantly: an asset_validation_records
 * row only gains value when the underlying file or its package metadata has actually changed.
 */
const DEFAULT_ASSET_VALIDATION_INTERVAL_MS = 5 * 60 * 1000;

/**
 * DEFAULT_ASSET_VALIDATION_BATCH_LIMIT caps validations per daemon tick so a one-time backlog
 * (e.g. a fresh ingestion of 1000 footprints) does not starve heartbeats or bundle assembly.
 */
const DEFAULT_ASSET_VALIDATION_BATCH_LIMIT = 5;

/**
 * DEFAULT_PROJECT_DOCUMENT_EXTRACTION_INTERVAL_MS keeps newly discovered documents
 * moving quickly while leaving the API request itself non-blocking.
 */
const DEFAULT_PROJECT_DOCUMENT_EXTRACTION_INTERVAL_MS = 20_000;

/** DEFAULT_PROJECT_DOCUMENT_EXTRACTION_BATCH_LIMIT bounds document reads per daemon tick. */
const DEFAULT_PROJECT_DOCUMENT_EXTRACTION_BATCH_LIMIT = 3;

/** DEFAULT_PROVIDER_ENRICHMENT_INTERVAL_MS paces datasheet capture/extraction so imports enrich automatically. */
const DEFAULT_PROVIDER_ENRICHMENT_INTERVAL_MS = 30_000;

/** DEFAULT_PROVIDER_ENRICHMENT_BATCH_LIMIT bounds enrichment jobs (each fetches a PDF) per daemon tick. */
const DEFAULT_PROVIDER_ENRICHMENT_BATCH_LIMIT = 5;

/**
 * DEFAULT_BOM_BACKFILL_INTERVAL_MS paces the missing-part backfill queue. Each request fans an
 * exact lookup out to every configured provider and may run a full import, so the tick plus the
 * low in-pass concurrency keeps a 1,500-MPN library backfill inside free-tier provider rate
 * limits while still clearing roughly a BOM's worth of rows per minute.
 */
const DEFAULT_BOM_BACKFILL_INTERVAL_MS = 20_000;

/** DEFAULT_BOM_BACKFILL_BATCH_LIMIT bounds backfill requests (each may fetch + import) per daemon tick. */
const DEFAULT_BOM_BACKFILL_BATCH_LIMIT = 10;

/**
 * Runs the worker daemon: emits a heartbeat on a periodic interval until SIGINT/SIGTERM, drains
 * pending export-bundle asset-byte assemblies, and refreshes stale active supply-offer snapshots.
 *
 * Used by the local-dev `npm run dev:worker` script and the GET /system/health liveness check.
 */
async function runDaemon(): Promise<void> {
  // Bind the converter once at daemon startup so the env-driven configuration is read a single
  // time. A misconfigured PEM-style env var (`EE_LIBRARY_STEP_TO_GLTF_FORMAT` outside glb/gltf)
  // raises here so the operator sees the failure immediately instead of on the first tick.
  const threeDPreviewConverter = buildThreeDPreviewConverterFromEnv();
  setThreeDPreviewConverter(threeDPreviewConverter);

  console.log(
    `Worker daemon starting (workerId=${resolveWorkerId()}, heartbeat=${DEFAULT_HEARTBEAT_INTERVAL_MS}ms, bundleAssembly=${DEFAULT_BUNDLE_ASSEMBLY_INTERVAL_MS}ms, projectDocumentExtraction=${DEFAULT_PROJECT_DOCUMENT_EXTRACTION_INTERVAL_MS}ms, supplyOfferRefresh=${DEFAULT_SUPPLY_OFFER_REFRESH_INTERVAL_MS}ms, threeDPreview=${DEFAULT_THREE_D_PREVIEW_INTERVAL_MS}ms${threeDPreviewConverter ? "" : " (no converter configured)"}, assetValidation=${DEFAULT_ASSET_VALIDATION_INTERVAL_MS}ms).`
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

  const threeDPreviewInterval = setInterval(() => {
    void safeProcessPendingThreeDPreviews();
  }, DEFAULT_THREE_D_PREVIEW_INTERVAL_MS);

  const assetValidationInterval = setInterval(() => {
    void safeRunAssetValidations();
  }, DEFAULT_ASSET_VALIDATION_INTERVAL_MS);

  const projectDocumentExtractionInterval = setInterval(() => {
    void safeProcessProjectDocumentExtractions();
  }, DEFAULT_PROJECT_DOCUMENT_EXTRACTION_INTERVAL_MS);

  const providerEnrichmentInterval = setInterval(() => {
    void safeProcessProviderEnrichmentJobs();
  }, DEFAULT_PROVIDER_ENRICHMENT_INTERVAL_MS);

  const bomBackfillInterval = setInterval(() => {
    void safeProcessBomBackfillRequests();
  }, DEFAULT_BOM_BACKFILL_INTERVAL_MS);

  // Run one assembly pass right after startup so a bundle queued while the daemon was offline does
  // not have to wait a full interval before the worker picks it up.
  void safeProcessPendingExportBundleAssembly();
  void safeRefreshStaleSupplyOffers();
  void safeProcessPendingThreeDPreviews();
  void safeRunAssetValidations();
  void safeProcessProjectDocumentExtractions();
  void safeProcessProviderEnrichmentJobs();
  void safeProcessBomBackfillRequests();

  await new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(heartbeatInterval);
      clearInterval(bundleAssemblyInterval);
      clearInterval(supplyOfferRefreshInterval);
      clearInterval(threeDPreviewInterval);
      clearInterval(assetValidationInterval);
      clearInterval(projectDocumentExtractionInterval);
      clearInterval(providerEnrichmentInterval);
      clearInterval(bomBackfillInterval);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  console.log("Worker daemon stopping.");
  await shutdownHeartbeatPool();
}

/**
 * Reads queued project PDF and Office files without crashing the daemon on one bad file.
 */
async function safeProcessProjectDocumentExtractions(): Promise<void> {
  try {
    const summary = await processProjectDocumentExtractionJobs(
      DEFAULT_PROJECT_DOCUMENT_EXTRACTION_BATCH_LIMIT
    );
    if (summary.processed.length === 0) {
      return;
    }

    const succeeded = summary.processed.filter((row) => row.status === "succeeded").length;
    const failed = summary.processed.filter((row) => row.status === "failed").length;
    const superseded = summary.processed.filter((row) => row.status === "superseded").length;
    console.log(
      `Worker daemon: read ${succeeded} project document${succeeded === 1 ? "" : "s"}` +
        (failed > 0 ? `, ${failed} failed` : "") +
        (superseded > 0 ? `, ${superseded} replaced by newer copies` : "") +
        (summary.recoveredStaleCount > 0
          ? `, ${summary.recoveredStaleCount} abandoned read${summary.recoveredStaleCount === 1 ? "" : "s"} retried`
          : "")
    );
  } catch (error) {
    console.error("Project document extraction tick failed.", error instanceof Error ? error.message : error);
  }
}

/** enrichmentTickRunning guards against overlapping enrichment ticks, since each job may fetch a PDF. */
let enrichmentTickRunning = false;

/**
 * Processes queued provider enrichment jobs (datasheet capture + confirm-by-search extraction) without
 * crashing the daemon on one bad job or a slow PDF fetch. Skips re-entry so a slow batch (each job can
 * fetch a datasheet) does not pile up overlapping runs when the interval fires again.
 */
async function safeProcessProviderEnrichmentJobs(): Promise<void> {
  if (enrichmentTickRunning) {
    return;
  }

  enrichmentTickRunning = true;

  try {
    const summary = await processProviderEnrichmentJobs(DEFAULT_PROVIDER_ENRICHMENT_BATCH_LIMIT);

    if (summary.processed.length === 0) {
      return;
    }

    const succeeded = summary.processed.filter((row) => row.status === "succeeded").length;
    const failed = summary.processed.filter((row) => row.status === "failed").length;
    console.log(`Worker daemon: processed ${succeeded} enrichment job${succeeded === 1 ? "" : "s"}` + (failed > 0 ? `, ${failed} failed` : "") + ".");
  } catch (error) {
    console.error("Provider enrichment tick failed.", error instanceof Error ? error.message : error);
  } finally {
    enrichmentTickRunning = false;
  }
}

/** bomBackfillTickRunning guards against overlapping backfill ticks, since each request may fetch and import. */
let bomBackfillTickRunning = false;

/**
 * Processes queued BOM backfill requests without crashing the daemon on one bad lookup or import.
 * Skips re-entry so a slow provider batch does not pile up overlapping runs when the interval
 * fires again — the pacing is the point: it keeps library-scale backfills polite to providers.
 */
async function safeProcessBomBackfillRequests(): Promise<void> {
  if (bomBackfillTickRunning) {
    return;
  }

  bomBackfillTickRunning = true;

  try {
    const summary = await processBomBackfillRequests(DEFAULT_BOM_BACKFILL_BATCH_LIMIT);

    if (summary.processed.length === 0) {
      return;
    }

    const imported = summary.processed.filter((row) => row.status === "imported").length;
    const parked = summary.processed.filter((row) => row.status === "needs_choice" || row.status === "no_match").length;
    const failed = summary.processed.filter((row) => row.status === "failed").length;
    console.log(
      `Worker daemon: backfilled ${imported} missing part${imported === 1 ? "" : "s"}` +
        (parked > 0 ? `, ${parked} parked for review` : "") +
        (failed > 0 ? `, ${failed} failed` : "") +
        "."
    );
  } catch (error) {
    console.error("BOM backfill tick failed.", error instanceof Error ? error.message : error);
  } finally {
    bomBackfillTickRunning = false;
  }
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
 * Generates STEP→glTF preview artifacts without crashing the daemon on storage / DB failures.
 *
 * Logs only when the tick selected work, and only summarizes converter availability when the
 * batch was non-empty -- otherwise an unconverted-by-design system would log noisily forever.
 */
async function safeProcessPendingThreeDPreviews(): Promise<void> {
  try {
    const storage = getWorkerStorageClient();
    const summary = await processPendingThreeDPreviewJobs(DEFAULT_THREE_D_PREVIEW_BATCH_LIMIT, storage);

    if (summary.processed.length === 0) {
      return;
    }

    const converted = summary.processed.filter((row) => row.status === "converted").length;
    const skipped = summary.processed.filter((row) => row.status === "skipped_converter_unavailable").length;
    const failed = summary.processed.filter((row) => row.status === "conversion_failed" || row.status === "skipped_source_unreadable").length;
    console.log(
      `Worker daemon: 3D preview pass ${converted} converted` +
        (skipped > 0 ? `, ${skipped} skipped (converter unavailable)` : "") +
        (failed > 0 ? `, ${failed} failed` : "")
    );
  } catch (error) {
    console.error("3D preview tick failed.", error instanceof Error ? error.message : error);
  }
}

/**
 * Runs the file-grounded asset validators (footprint + symbol + STEP integrity) without
 * crashing the daemon on storage / DB failures. Logs only when the tick produced new evidence
 * so an idle system stays quiet, and keeps the outcomes separate so an operator can see which
 * validator surfaced which decisions.
 */
async function safeRunAssetValidations(): Promise<void> {
  try {
    const storage = getWorkerStorageClient();
    const footprintSummary = await processFootprintGeometryValidations(DEFAULT_ASSET_VALIDATION_BATCH_LIMIT, storage);
    const symbolSummary = await processSymbolPinCountValidations(DEFAULT_ASSET_VALIDATION_BATCH_LIMIT, storage);
    const threeDSummary = await processThreeDGeometryValidations(DEFAULT_ASSET_VALIDATION_BATCH_LIMIT, storage);

    if (
      footprintSummary.processed.length === 0 &&
      symbolSummary.processed.length === 0 &&
      threeDSummary.processed.length === 0
    ) {
      return;
    }

    const footprintFailed = footprintSummary.processed.filter((row) => row.recordedStatus === "failed").length;
    const symbolFailed = symbolSummary.processed.filter((row) => row.recordedStatus === "failed").length;
    const threeDFailed = threeDSummary.processed.filter((row) => row.recordedStatus === "failed").length;
    console.log(
      `Worker daemon: asset validation pass — footprints: ${footprintSummary.processed.length} candidates` +
        (footprintFailed > 0 ? `, ${footprintFailed} failed` : "") +
        `; symbols: ${symbolSummary.processed.length} candidates` +
        (symbolFailed > 0 ? `, ${symbolFailed} failed` : "") +
        `; 3D models: ${threeDSummary.processed.length} candidates` +
        (threeDFailed > 0 ? `, ${threeDFailed} failed` : "")
    );
  } catch (error) {
    console.error("Asset validation tick failed.", error instanceof Error ? error.message : error);
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
