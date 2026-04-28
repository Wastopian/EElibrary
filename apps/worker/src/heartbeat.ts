/**
 * File header: Worker heartbeat helpers. Writes worker_heartbeats rows so api/web can show liveness.
 */

import { Pool } from "pg";
import { WORKER_HEARTBEAT_STALE_SECONDS } from "@ee-library/shared";

/** DEFAULT_WORKER_ID is the heartbeat row identifier when WORKER_ID is not set. */
export const DEFAULT_WORKER_ID = "default";

/** DEFAULT_HEARTBEAT_INTERVAL_MS is half the staleness window so a single missed tick is forgiving. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = Math.max(1, Math.floor((WORKER_HEARTBEAT_STALE_SECONDS * 1000) / 3));

/** sharedPool is lazily initialized to avoid forcing a Postgres connection during status-only commands. */
let sharedPool: Pool | null = null;

/**
 * Returns a process-wide Pool used by the worker for heartbeat writes.
 */
function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to emit worker heartbeats.");
  }

  sharedPool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return sharedPool;
}

/**
 * Resolves the worker identifier used for heartbeat rows.
 */
export function resolveWorkerId(): string {
  return process.env.WORKER_ID?.trim() || DEFAULT_WORKER_ID;
}

/**
 * Writes one heartbeat row for the configured worker id. Idempotent: upserts the same row.
 */
export async function emitHeartbeat(details: Record<string, unknown> = {}): Promise<void> {
  const pool = getPool();

  await pool.query(
    `
      INSERT INTO worker_heartbeats (worker_id, last_seen_at, details)
      VALUES ($1, now(), $2::jsonb)
      ON CONFLICT (worker_id) DO UPDATE
        SET last_seen_at = EXCLUDED.last_seen_at,
            details = EXCLUDED.details
    `,
    [resolveWorkerId(), JSON.stringify(details)]
  );
}

/**
 * Closes the heartbeat pool. Safe to call when no pool was created.
 */
export async function shutdownHeartbeatPool(): Promise<void> {
  if (sharedPool) {
    const pool = sharedPool;
    sharedPool = null;
    await pool.end();
  }
}
