/**
 * File header: Postgres client and connectivity helpers used by setup/db scripts.
 */

import pg from "pg";
import { isLocalDatabase as isLocalDatabaseUrl, requireDatabaseUrl } from "./db-url.mjs";

const { Client, Pool } = pg;

export { requireDatabaseUrl };

/**
 * Connects a single pg.Client using DATABASE_URL and returns it.
 * Callers are responsible for calling client.end().
 */
export async function connectClient() {
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  return client;
}

/**
 * Creates a short-lived pool for higher-throughput callers.
 */
export function createPool() {
  return new Pool({ connectionString: requireDatabaseUrl() });
}

/**
 * Polls the database until it accepts connections or the timeout elapses.
 * Returns when reachable; throws after the timeout.
 */
export async function waitForPostgres({ timeoutMs = 60_000, intervalMs = 1_000 } = {}) {
  const url = requireDatabaseUrl();
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      if (isAuthFailure(error)) {
        throw new Error(
          "Postgres rejected DATABASE_URL credentials (password authentication failed).\n" +
            "If this is a local Docker setup, an old Postgres volume likely has different credentials.\n" +
            "Run `docker compose down -v` from the repo root, then re-run `npm run setup:dev`."
        );
      }
      try {
        await client.end();
      } catch {
        /* ignore end errors when connect failed */
      }
      await sleep(intervalMs);
    }
  }

  throw new Error(`Postgres was not reachable within ${timeoutMs}ms: ${describeError(lastError)}`);
}

/**
 * Returns true when the configured DATABASE_URL targets a localhost-style host.
 */
export function isLocalDatabase(url = requireDatabaseUrl()) {
  return isLocalDatabaseUrl(url);
}

function describeError(error) {
  if (!error) {
    return "unknown error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isAuthFailure(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && error.code === "28P01";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
