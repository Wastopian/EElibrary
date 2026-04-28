/**
 * File header: Shared shapes for the /system/health response so api and web stay aligned.
 */

/** WorkerLivenessStatus tracks worker daemon visibility based on recent heartbeats. */
export type WorkerLivenessStatus = "online" | "offline" | "unknown";

/** ServiceConnectionStatus describes a backing service's current reachability. */
export type ServiceConnectionStatus = "connected" | "unavailable" | "not_configured";

/** SystemHealthResponse is the canonical shape returned by GET /system/health. */
export interface SystemHealthResponse {
  /** Overall API service status. Always "ok" if the response is served. */
  api: { status: "ok" };
  /** Postgres connectivity for read paths. */
  database: { status: ServiceConnectionStatus };
  /** Object storage configuration state. */
  objectStorage: { status: ServiceConnectionStatus };
  /** Worker daemon liveness derived from worker_heartbeats. */
  worker: {
    status: WorkerLivenessStatus;
    /** ISO timestamp of the most recent heartbeat the API observed. */
    lastSeenAt: string | null;
    /** Seconds the heartbeat may be stale before the worker is treated as offline. */
    staleAfterSeconds: number;
  };
  /** Pending and failed counts per logical queue. Zero when the queue is not wired up yet. */
  queues: {
    acquisition: { pending: number; failed: number };
    enrichment: { pending: number; failed: number };
  };
}

/** WORKER_HEARTBEAT_STALE_SECONDS is the default staleness threshold used by api and web. */
export const WORKER_HEARTBEAT_STALE_SECONDS = 30;
