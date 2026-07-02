/**
 * File header: Tests the request-scoped tenant transaction facade (RLS backstop, Increment 5).
 *
 * Uses a stub pool that records every statement, so these tests pin the exact transaction protocol the
 * facade speaks: lazy checkout, tenant binding via set_config, store BEGIN/COMMIT/ROLLBACK mapped onto
 * savepoints, tolerant no-ops for unmatched rollbacks, and commit/rollback + release at request end.
 * The RLS policies themselves run only on real Postgres and are proven by the CI smoke's cross-org
 * probes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getRequestDb, releaseRequestDbEarly, runWithRequestDb, setRequestDbPoolForTests } from "./request-db";

/** StubRecord captures one statement issued through the facade. */
interface StubRecord {
  sql: string;
  params: unknown[] | undefined;
}

/** Builds a stub pool that records statements and tracks checkout/release. */
function createStubPool() {
  const statements: StubRecord[] = [];
  const state = { checkouts: 0, destroyed: 0, released: 0 };

  const client = {
    async query(sql: string, params?: unknown[]) {
      statements.push({ params, sql });
      return { command: "", fields: [], oid: 0, rowCount: 0, rows: [] };
    },
    release(destroy?: boolean) {
      state.released += 1;
      if (destroy) {
        state.destroyed += 1;
      }
    }
  };

  const pool = {
    async connect() {
      state.checkouts += 1;
      return client;
    },
    async query(sql: string, params?: unknown[]) {
      statements.push({ params, sql: `POOL:${sql}` });
      return { command: "", fields: [], oid: 0, rowCount: 0, rows: [] };
    }
  };

  return { pool: pool as unknown as Pool, state, statements };
}

test("request db lazily begins one tenant transaction and commits at request end", async () => {
  const stub = createStubPool();
  setRequestDbPoolForTests(stub.pool);

  try {
    await runWithRequestDb("org-alpha", async () => {
      const db = getRequestDb();
      assert.ok(db, "a facade exists inside the request");
      assert.equal(stub.state.checkouts, 0, "nothing is checked out before the first query");

      await db!.query("SELECT 1");
      await db!.query("SELECT 2");
    });

    assert.equal(stub.state.checkouts, 1, "one client serves the whole request");
    assert.deepEqual(
      stub.statements.map((record) => record.sql),
      ["BEGIN", "SELECT set_config('app.current_org', $1, true)", "SELECT 1", "SELECT 2", "COMMIT"],
      "one transaction wraps the request with the tenant bound first"
    );
    assert.deepEqual(stub.statements[1]?.params, ["org-alpha"], "the acting org is bound");
    assert.equal(stub.state.released, 1, "the client returns to the pool");
    assert.equal(stub.state.destroyed, 0);
  } finally {
    setRequestDbPoolForTests(null);
  }
});

test("request db binds '' for anonymous requests so policies fail closed", async () => {
  const stub = createStubPool();
  setRequestDbPoolForTests(stub.pool);

  try {
    await runWithRequestDb(null, async () => {
      await getRequestDb()!.query("SELECT 1");
    });

    assert.deepEqual(stub.statements[1]?.params, [""], "no tenant binds the empty string, which matches no org_id");
  } finally {
    setRequestDbPoolForTests(null);
  }
});

test("request db rolls back when the handler throws", async () => {
  const stub = createStubPool();
  setRequestDbPoolForTests(stub.pool);

  try {
    await assert.rejects(
      () =>
        runWithRequestDb("org-alpha", async () => {
          await getRequestDb()!.query("INSERT INTO t VALUES (1)");
          throw new Error("handler failed");
        }),
      /handler failed/u
    );

    assert.equal(stub.statements.at(-1)?.sql, "ROLLBACK", "a failed request rolls its writes back");
    assert.equal(stub.state.released, 1);
  } finally {
    setRequestDbPoolForTests(null);
  }
});

test("store-level BEGIN/COMMIT/ROLLBACK map onto savepoints inside the request transaction", async () => {
  const stub = createStubPool();
  setRequestDbPoolForTests(stub.pool);

  try {
    await runWithRequestDb("org-alpha", async () => {
      const db = getRequestDb()!;

      // First store transaction commits.
      const first = await db.connect();
      await first.query("BEGIN");
      await first.query("INSERT INTO t VALUES (1)");
      await first.query("COMMIT");
      first.release();

      // Second store transaction rolls back (its catch path), then rolls back again unconditionally —
      // the second rollback must NOT touch the outer request transaction.
      const second = await db.connect();
      await second.query("BEGIN");
      await second.query("INSERT INTO t VALUES (2)");
      await second.query("ROLLBACK");
      await second.query("ROLLBACK");
      second.release();
    });

    assert.deepEqual(
      stub.statements.map((record) => record.sql),
      [
        "BEGIN",
        "SELECT set_config('app.current_org', $1, true)",
        "SAVEPOINT ee_store_tx_1",
        "INSERT INTO t VALUES (1)",
        "RELEASE SAVEPOINT ee_store_tx_1",
        "SAVEPOINT ee_store_tx_1",
        "INSERT INTO t VALUES (2)",
        "ROLLBACK TO SAVEPOINT ee_store_tx_1",
        "RELEASE SAVEPOINT ee_store_tx_1",
        "COMMIT"
      ],
      "store transactions become savepoints; the unmatched rollback is a no-op; the request still commits"
    );
    assert.equal(stub.state.checkouts, 1, "store transactions reuse the request client");
  } finally {
    setRequestDbPoolForTests(null);
  }
});

test("releaseRequestDbEarly commits before streaming and later work falls to the bare pool", async () => {
  const stub = createStubPool();
  setRequestDbPoolForTests(stub.pool);

  try {
    await runWithRequestDb("org-alpha", async () => {
      const db = getRequestDb()!;
      await db.query("SELECT gate");

      await releaseRequestDbEarly();
      assert.equal(getRequestDb(), null, "the facade is gone after early release");

      // A stray query after early release runs on the bare pool (no tenant bound → RLS fails closed)
      // rather than crashing detached async work.
      await db.query("SELECT stray");
    });

    assert.deepEqual(
      stub.statements.map((record) => record.sql),
      ["BEGIN", "SELECT set_config('app.current_org', $1, true)", "SELECT gate", "COMMIT", "POOL:SELECT stray"],
      "early release commits once; the stray query bypasses the finished transaction"
    );
    assert.equal(stub.state.released, 1, "the double finalize (early + request end) releases exactly once");
  } finally {
    setRequestDbPoolForTests(null);
  }
});

test("request db does nothing when the request never touches the database", async () => {
  const stub = createStubPool();
  setRequestDbPoolForTests(stub.pool);

  try {
    await runWithRequestDb("org-alpha", async () => {
      // Health checks / 404s / seed-fallback routes issue no queries.
    });

    assert.equal(stub.state.checkouts, 0, "no client is checked out");
    assert.equal(stub.statements.length, 0, "no statements are issued");
  } finally {
    setRequestDbPoolForTests(null);
  }
});

test("getRequestDb returns null outside a request", () => {
  assert.equal(getRequestDb(), null, "tests and non-request paths see no facade");
});
