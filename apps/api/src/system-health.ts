/**
 * File header: Builds the GET /system/health response from database, worker heartbeat,
 * and storage configuration. The web app uses this to surface offline-worker copy and to
 * keep queued-job UI from polling silently when the worker process is not running.
 */

import { Pool } from "pg";
import {
  WORKER_HEARTBEAT_STALE_SECONDS,
  type ServiceConnectionStatus,
  type SystemHealthResponse,
  type WorkerLivenessStatus
} from "@ee-library/shared";
import { getStorageClient } from "./file-storage";

/** sharedPool is lazy so health checks can run when DATABASE_URL is unset. */
let sharedPool: Pool | null = null;

/**
 * Returns a process-wide Pool when DATABASE_URL is configured.
 */
function getDatabasePool(): Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  sharedPool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return sharedPool;
}

/** SystemHealthDeps lets tests inject fakes for the database read path. */
export interface SystemHealthDeps {
  /** Optional pool override; when omitted the shared pool is used. */
  pool?: Pool;
  /** Optional clock override; defaults to Date.now(). */
  now?: () => number;
  /** Optional staleness threshold; defaults to WORKER_HEARTBEAT_STALE_SECONDS. */
  staleAfterSeconds?: number;
}

/**
 * Assembles the system health payload. Never throws; all backend failures map to status fields.
 */
export async function buildSystemHealth(deps: SystemHealthDeps = {}): Promise<SystemHealthResponse> {
  const staleAfterSeconds = deps.staleAfterSeconds ?? WORKER_HEARTBEAT_STALE_SECONDS;
  const now = deps.now ?? Date.now;
  const pool = deps.pool ?? getDatabasePool();

  const databaseStatus: ServiceConnectionStatus = pool ? await pingDatabase(pool) : "not_configured";
  const workerHeartbeat = pool && databaseStatus === "connected" ? await readLatestHeartbeat(pool) : null;
  const workerLiveness = computeWorkerLiveness(workerHeartbeat, now(), staleAfterSeconds);
  const queueCounts = pool && databaseStatus === "connected" ? await readQueueCounts(pool) : { acquisition: { pending: 0, failed: 0 }, enrichment: { pending: 0, failed: 0 } };

  return {
    api: { status: "ok" },
    database: { status: databaseStatus },
    objectStorage: { status: readObjectStorageStatus() },
    queues: queueCounts,
    worker: {
      lastSeenAt: workerHeartbeat ? workerHeartbeat.toISOString() : null,
      staleAfterSeconds,
      status: workerLiveness
    }
  };
}

/**
 * Returns the most recent worker heartbeat timestamp or null when none exists.
 * Returns null on schema/missing-table errors so the route stays safe before migrations run.
 */
export async function readLatestHeartbeat(pool: Pool): Promise<Date | null> {
  try {
    const result = await pool.query<{ last_seen_at: Date | string }>(
      "SELECT last_seen_at FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1"
    );
    if (result.rowCount === 0) {
      return null;
    }
    const value = result.rows[0]?.last_seen_at;
    if (value === undefined || value === null) {
      return null;
    }
    return value instanceof Date ? value : new Date(value);
  } catch {
    return null;
  }
}

/**
 * Pings the database with a trivial query. Returns "connected" or "unavailable".
 */
async function pingDatabase(pool: Pool): Promise<ServiceConnectionStatus> {
  try {
    await pool.query("SELECT 1");
    return "connected";
  } catch {
    return "unavailable";
  }
}

/**
 * Computes the worker liveness from the most recent heartbeat timestamp.
 */
export function computeWorkerLiveness(lastSeenAt: Date | null, nowMs: number, staleAfterSeconds: number): WorkerLivenessStatus {
  if (!lastSeenAt) {
    return "offline";
  }
  const ageMs = nowMs - lastSeenAt.getTime();
  if (Number.isNaN(ageMs)) {
    return "unknown";
  }
  return ageMs <= staleAfterSeconds * 1000 ? "online" : "offline";
}

/**
 * Reads queue counts when the relevant tables exist. Returns zeroed counts on missing tables.
 */
async function readQueueCounts(pool: Pool): Promise<SystemHealthResponse["queues"]> {
  const [acquisition, enrichment] = await Promise.all([
    readQueueCount(pool, "provider_acquisition_jobs"),
    readQueueCount(pool, "provider_enrichment_jobs")
  ]);

  return {
    acquisition,
    enrichment
  };
}

/**
 * Reads one queue table's active and failed counts without throwing when the schema is absent.
 */
async function readQueueCount(pool: Pool, tableName: "provider_acquisition_jobs" | "provider_enrichment_jobs"): Promise<{ pending: number; failed: number }> {
  try {
    const result = await pool.query<{ pending: string | number; failed: string | number }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE job_status IN ('queued', 'running')) AS pending,
          COUNT(*) FILTER (WHERE job_status = 'failed') AS failed
        FROM ${tableName}
      `
    );
    const row = result.rows[0];

    return {
      failed: readCount(row?.failed),
      pending: readCount(row?.pending)
    };
  } catch {
    return { failed: 0, pending: 0 };
  }
}

/**
 * Maps the active storage backend to the provider-neutral health status vocabulary.
 */
function readObjectStorageStatus(): ServiceConnectionStatus {
  return getStorageClient().backend === "not_configured" ? "not_configured" : "connected";
}

/**
 * Converts Postgres count values into finite numbers for JSON health output.
 */
function readCount(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}
