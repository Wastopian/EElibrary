/**
 * File header: Request-scoped tenant database access for the RLS backstop (Increment 5).
 *
 * Every scoped table now carries a Row-Level Security policy keyed on the `app.current_org` setting
 * (migration 055). For the policy to see the acting tenant, every query of a request must run on a
 * connection where that setting is bound — so each request lazily checks out ONE pooled client, opens
 * a transaction, binds the tenant with set_config(..., true), and runs all of its store queries on it.
 * The transaction commits (or rolls back, when the handler threw) at the end of the request.
 *
 * Design properties:
 *  - Lazy: nothing is checked out until the first store query, so health checks, 404s, and
 *    seed-fallback routes never touch the pool.
 *  - Fail-closed: an anonymous request binds '' (matches no org_id); a connection that never bound the
 *    setting sees no rows on policied tables.
 *  - Drop-in: the facade is Pool-compatible for the two members stores use (`query`, `connect`). Store
 *    transactions that literally issue "BEGIN" / "COMMIT" / "ROLLBACK" on a connected client are mapped
 *    onto savepoints inside the request transaction, so the existing 20 call sites work unedited.
 *  - Consolidating: one bounded pool (EE_LIBRARY_DB_POOL_SIZE, default 10) replaces the per-store lazy
 *    pools on request paths.
 *
 * Durability note: writes become durable at the request-end COMMIT (after the response is written).
 * A COMMIT that fails after a success response is limited to connection loss at that instant — there
 * are no deferred constraints, so statement-time errors (including RLS WITH CHECK) still surface to
 * the handler exactly as before. In exchange, a request that fails mid-way rolls back atomically.
 *
 * The audit log intentionally does NOT use this facade: its flush runs in the request `finally`,
 * including after failures when this transaction has already aborted, so it keeps a dedicated pool
 * (audit_events has no org_id and no policy).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResult } from "pg";

/** RequestDbState tracks the lazily-checked-out client for one request. */
interface RequestDbState {
  /** Acting tenant bound into app.current_org ('' when anonymous, so policies match nothing). */
  orgId: string | null;
  /** The checked-out client once materialized. */
  client: PoolClient | null;
  /** Memoized checkout so concurrent first queries begin exactly one transaction. */
  checkout: Promise<PoolClient> | null;
  /** Depth of store-level pseudo-transactions currently mapped onto savepoints. */
  savepointDepth: number;
  /** True once the request transaction was finalized (committed / rolled back / released early). */
  finished: boolean;
  /** The Pool-shaped facade handed to store getters. */
  facade: Pool;
}

const requestDb = new AsyncLocalStorage<RequestDbState>();

let sharedPool: Pool | null = null;
let sharedPoolForTests: Pool | null = null;

/** Test-only: injects the pool the request facade checks clients out of. */
export function setRequestDbPoolForTests(pool: Pool | null): void {
  sharedPoolForTests = pool;
}

/**
 * Returns the single shared pool for request-scoped clients, or null when the database is not
 * configured (catalog seed-fallback mode).
 */
function getSharedPool(): Pool | null {
  if (sharedPoolForTests) {
    return sharedPoolForTests;
  }

  if (sharedPool) {
    return sharedPool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  sharedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: readPoolSize()
  });

  return sharedPool;
}

/** Reads the bounded pool size, defaulting to 10 connections. */
function readPoolSize(): number {
  const raw = Number.parseInt(process.env.EE_LIBRARY_DB_POOL_SIZE ?? "", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 10;
}

/**
 * Checks out the request's client on first use: one connection, one transaction, tenant bound with
 * transaction scope so it can never leak onto the connection after release.
 */
async function ensureRequestClient(state: RequestDbState): Promise<PoolClient> {
  if (state.client) {
    return state.client;
  }

  if (!state.checkout) {
    state.checkout = (async () => {
      const pool = getSharedPool();

      if (!pool) {
        throw new Error("request_db_not_configured");
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_org', $1, true)", [state.orgId ?? ""]);
      } catch (error) {
        client.release(true);
        throw error;
      }

      state.client = client;
      return client;
    })();

    // Clear the memo on failure so a later query in the same request can retry (e.g. transient
    // connect errors surfaced to system-health probes).
    state.checkout.catch(() => {
      state.checkout = null;
    });
  }

  return state.checkout;
}

/** A QueryResult-shaped no-op for intercepted transaction-control statements. */
function noopResult(): QueryResult {
  return { command: "SET", fields: [], oid: 0, rowCount: 0, rows: [] } as unknown as QueryResult;
}

/**
 * Builds the pseudo-client returned by facade.connect(): store-level "BEGIN"/"COMMIT"/"ROLLBACK" become
 * savepoint operations inside the request transaction (LIFO nesting via a depth counter; tolerant
 * no-ops when no savepoint is active, because some catch blocks roll back unconditionally). Everything
 * else passes through to the request client. release() is a no-op — the client belongs to the request.
 */
function buildSavepointClient(state: RequestDbState, client: PoolClient): PoolClient {
  const savepointName = () => `ee_store_tx_${state.savepointDepth}`;

  const pseudo = {
    async query(...args: unknown[]): Promise<QueryResult> {
      const [first] = args;

      if (typeof first === "string") {
        const statement = first.trim().toUpperCase();

        if (statement === "BEGIN") {
          state.savepointDepth += 1;
          await client.query(`SAVEPOINT ${savepointName()}`);
          return noopResult();
        }

        if (statement === "COMMIT") {
          if (state.savepointDepth > 0) {
            await client.query(`RELEASE SAVEPOINT ${savepointName()}`);
            state.savepointDepth -= 1;
          }
          return noopResult();
        }

        if (statement === "ROLLBACK") {
          if (state.savepointDepth > 0) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepointName()}`);
            await client.query(`RELEASE SAVEPOINT ${savepointName()}`);
            state.savepointDepth -= 1;
          }
          return noopResult();
        }
      }

      return (client.query as (...a: unknown[]) => Promise<QueryResult>)(...args);
    },
    release(): void {
      // The underlying client is released once, at the end of the request.
    }
  };

  return pseudo as unknown as PoolClient;
}

/** Builds the Pool-shaped facade store getters hand to unchanged store code. */
function buildFacade(state: RequestDbState): Pool {
  const facade = {
    async query(...args: unknown[]): Promise<QueryResult> {
      if (state.finished) {
        // Stray post-response work (should not happen): run on the bare pool, where the missing
        // tenant setting fails closed instead of crashing detached async code.
        const pool = getSharedPool();
        if (!pool) throw new Error("request_db_not_configured");
        return (pool.query as (...a: unknown[]) => Promise<QueryResult>)(...args);
      }

      const client = await ensureRequestClient(state);
      return (client.query as (...a: unknown[]) => Promise<QueryResult>)(...args);
    },
    async connect(): Promise<PoolClient> {
      if (state.finished) {
        const pool = getSharedPool();
        if (!pool) throw new Error("request_db_not_configured");
        return pool.connect();
      }

      const client = await ensureRequestClient(state);
      return buildSavepointClient(state, client);
    }
  };

  return facade as unknown as Pool;
}

/**
 * Commits (or rolls back) and releases the request's client. Safe to call more than once.
 */
async function finalizeRequestDb(state: RequestDbState, errored: boolean): Promise<void> {
  if (state.finished) {
    return;
  }

  state.finished = true;
  const client = state.client;
  state.client = null;
  state.checkout = null;

  if (!client) {
    return;
  }

  try {
    await client.query(errored ? "ROLLBACK" : "COMMIT");
    client.release();
  } catch (error) {
    // The connection is unusable (e.g. dropped mid-request): destroy it rather than pooling it.
    client.release(true);

    if (!errored) {
      throw error;
    }
  }
}

/**
 * Runs one request with a lazily-materialized tenant transaction. When the database is not configured
 * at all, runs the request without a facade so seed-fallback behavior is untouched.
 */
export async function runWithRequestDb<T>(orgId: string | null, fn: () => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL && !sharedPoolForTests) {
    return fn();
  }

  const state: RequestDbState = {
    checkout: null,
    client: null,
    facade: null as unknown as Pool,
    finished: false,
    orgId,
    savepointDepth: 0
  };
  state.facade = buildFacade(state);

  return requestDb.run(state, async () => {
    try {
      const result = await fn();
      await finalizeRequestDb(state, false);
      return result;
    } catch (error) {
      try {
        await finalizeRequestDb(state, true);
      } catch {
        // The original handler error is the one worth surfacing.
      }
      throw error;
    }
  });
}

/**
 * Returns the current request's Pool-shaped tenant facade, or null outside a request (tests inject
 * store pools directly; scripts and the worker use their own bypass-configured pools).
 */
export function getRequestDb(): Pool | null {
  const state = requestDb.getStore();
  return state && !state.finished ? state.facade : null;
}

/**
 * Commits and releases the request's client before the handler finishes — used by the file-streaming
 * route so a slow download never holds a pooled connection. Later store queries in the same request
 * would run on the bare pool and fail closed, so call this only after all database work is done.
 */
export async function releaseRequestDbEarly(): Promise<void> {
  const state = requestDb.getStore();

  if (state) {
    await finalizeRequestDb(state, false);
  }
}
