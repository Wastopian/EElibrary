/**
 * File header: Defines the Phase 0 worker boundary without fake provider integrations.
 */

import { providerAdapters } from "./provider-adapters";

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
  /** Registered provider adapters remain zero until a real integration exists. */
  registeredProviderAdapters: number;
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
    queue: "not_connected_phase_0",
    registeredProviderAdapters: providerAdapters.length,
    service: "worker"
  };
}

/**
 * Starts the worker skeleton and exits after reporting its configured boundary.
 */
function main(): void {
  console.log(JSON.stringify(getWorkerStatus(), null, 2));
}

main();
