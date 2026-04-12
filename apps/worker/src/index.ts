/**
 * File header: Runs Phase 2 worker status and local provider ingestion commands.
 */

import { providerAdapters } from "./provider-adapters";
import { assertDatabaseReady, persistNormalizedPart } from "./catalog-repository";
import type { ProviderAdapter, ProviderPartRequest } from "./provider-adapters";

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
    service: "worker"
  };
}

/**
 * Ingests all locally available provider records into Postgres.
 */
async function ingestLocalCatalog(): Promise<void> {
  const adapter = getProviderAdapter("local-catalog");

  await assertDatabaseReady();

  for (const request of await adapter.listAvailablePartRequests()) {
    await ingestPart(adapter, request);
  }
}

/**
 * Fetches, normalizes, and persists one provider part request.
 */
async function ingestPart(adapter: ProviderAdapter, request: ProviderPartRequest): Promise<void> {
  const rawPayload = await adapter.fetchRawPart(request);
  const normalizedPart = adapter.normalizeRawPart(rawPayload);

  await persistNormalizedPart(normalizedPart);
  console.log(`Ingested ${normalizedPart.part.mpn} from ${adapter.id}`);
}

/**
 * Finds one registered provider adapter by identifier.
 */
function getProviderAdapter(adapterId: string): ProviderAdapter {
  const adapter = providerAdapters.find((candidate) => candidate.id === adapterId);

  if (!adapter) {
    throw new Error(`Provider adapter not registered: ${adapterId}`);
  }

  return adapter;
}

/**
 * Runs the requested worker command.
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";

  if (command === "status") {
    console.log(JSON.stringify(getWorkerStatus(), null, 2));
    return;
  }

  if (command === "ingest") {
    await ingestLocalCatalog();
    return;
  }

  throw new Error(`Unknown worker command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
