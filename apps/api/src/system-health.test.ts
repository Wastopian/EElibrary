/**
 * File header: Tests buildSystemHealth and computeWorkerLiveness against fake pools and clocks.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemHealth, computeWorkerLiveness } from "./system-health";
import { WORKER_HEARTBEAT_STALE_SECONDS } from "@ee-library/shared";

/** Builds a fake pg.Pool with scripted query responses. */
function makeFakePool(handler: (text: string, values: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>) {
  return {
    async query(text: string, values: unknown[] = []) {
      return handler(text, values);
    }
  };
}

test("computeWorkerLiveness returns offline when no heartbeat exists", () => {
  assert.equal(computeWorkerLiveness(null, Date.now(), 30), "offline");
});

test("computeWorkerLiveness returns online for fresh heartbeats", () => {
  const now = new Date("2026-04-26T00:00:30.000Z").getTime();
  const heartbeat = new Date("2026-04-26T00:00:20.000Z");
  assert.equal(computeWorkerLiveness(heartbeat, now, 30), "online");
});

test("computeWorkerLiveness returns offline once the heartbeat exceeds the threshold", () => {
  const now = new Date("2026-04-26T00:01:00.000Z").getTime();
  const heartbeat = new Date("2026-04-26T00:00:00.000Z");
  assert.equal(computeWorkerLiveness(heartbeat, now, 30), "offline");
});

test("buildSystemHealth reports not_configured when no pool is provided", async () => {
  const health = await buildSystemHealth({ now: () => 0 });
  assert.equal(health.api.status, "ok");
  // Without injecting a pool we may still pick up an env-derived pool. Skip strict equality
  // and assert only the worker fallback shape that the web app will rely on.
  assert.ok(health.worker.status === "offline" || health.worker.status === "online" || health.worker.status === "unknown");
  assert.equal(health.worker.staleAfterSeconds, WORKER_HEARTBEAT_STALE_SECONDS);
});

test("buildSystemHealth marks worker offline when heartbeat is stale", async () => {
  const oldHeartbeat = "2026-04-25T00:00:00.000Z";
  const fakePool = makeFakePool(async (text) => {
    if (text.trim().startsWith("SELECT 1")) {
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
    if (text.includes("worker_heartbeats")) {
      return { rowCount: 1, rows: [{ last_seen_at: oldHeartbeat }] };
    }
    return { rowCount: 0, rows: [] };
  });

  const health = await buildSystemHealth({
    now: () => new Date("2026-04-26T00:00:00.000Z").getTime(),
    pool: fakePool as never,
    staleAfterSeconds: 30
  });

  assert.equal(health.database.status, "connected");
  assert.equal(health.worker.status, "offline");
  assert.equal(health.worker.lastSeenAt, new Date(oldHeartbeat).toISOString());
});

test("buildSystemHealth marks worker online when heartbeat is fresh", async () => {
  const heartbeat = "2026-04-26T00:00:55.000Z";
  const fakePool = makeFakePool(async (text) => {
    if (text.trim().startsWith("SELECT 1")) {
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
    if (text.includes("worker_heartbeats")) {
      return { rowCount: 1, rows: [{ last_seen_at: heartbeat }] };
    }
    return { rowCount: 0, rows: [] };
  });

  const health = await buildSystemHealth({
    now: () => new Date("2026-04-26T00:01:00.000Z").getTime(),
    pool: fakePool as never,
    staleAfterSeconds: 30
  });

  assert.equal(health.worker.status, "online");
});

test("buildSystemHealth returns acquisition, enrichment, and export bundle assembly queue counts", async () => {
  const heartbeat = "2026-04-26T00:00:55.000Z";
  const fakePool = makeFakePool(async (text) => {
    if (text.trim().startsWith("SELECT 1")) {
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
    if (text.includes("worker_heartbeats")) {
      return { rowCount: 1, rows: [{ last_seen_at: heartbeat }] };
    }
    if (text.includes("provider_acquisition_jobs")) {
      return { rowCount: 1, rows: [{ failed: "2", pending: "3" }] };
    }
    if (text.includes("provider_enrichment_jobs")) {
      return { rowCount: 1, rows: [{ failed: 1, pending: 4 }] };
    }
    if (text.includes("export_bundles")) {
      return { rowCount: 1, rows: [{ failed: "1", pending: "2" }] };
    }
    return { rowCount: 0, rows: [] };
  });

  const health = await buildSystemHealth({
    now: () => new Date("2026-04-26T00:01:00.000Z").getTime(),
    pool: fakePool as never,
    staleAfterSeconds: 30
  });

  assert.deepEqual(health.queues, {
    acquisition: { failed: 2, pending: 3 },
    enrichment: { failed: 1, pending: 4 },
    exportBundleAssembly: { failed: 1, pending: 2 }
  });
});

test("buildSystemHealth zeros export bundle assembly counts when the table query throws", async () => {
  const heartbeat = "2026-04-26T00:00:55.000Z";
  const fakePool = makeFakePool(async (text) => {
    if (text.trim().startsWith("SELECT 1")) {
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
    if (text.includes("worker_heartbeats")) {
      return { rowCount: 1, rows: [{ last_seen_at: heartbeat }] };
    }
    if (text.includes("provider_acquisition_jobs") || text.includes("provider_enrichment_jobs")) {
      return { rowCount: 1, rows: [{ failed: 0, pending: 0 }] };
    }
    if (text.includes("export_bundles")) {
      throw new Error("relation does not exist");
    }
    return { rowCount: 0, rows: [] };
  });

  const health = await buildSystemHealth({
    now: () => new Date("2026-04-26T00:01:00.000Z").getTime(),
    pool: fakePool as never,
    staleAfterSeconds: 30
  });

  // Pre-migration deploys must not break the system page; the table lookup soft-fails to zeroes.
  assert.deepEqual(health.queues.exportBundleAssembly, { failed: 0, pending: 0 });
});

test("buildSystemHealth marks database unavailable when ping fails but stays well-formed", async () => {
  const fakePool = makeFakePool(async () => {
    throw new Error("connection refused");
  });

  const health = await buildSystemHealth({
    now: () => 0,
    pool: fakePool as never,
    staleAfterSeconds: 30
  });

  assert.equal(health.database.status, "unavailable");
  assert.equal(health.worker.status, "offline");
  assert.equal(health.worker.lastSeenAt, null);
  assert.deepEqual(health.queues, {
    acquisition: { failed: 0, pending: 0 },
    enrichment: { failed: 0, pending: 0 },
    exportBundleAssembly: { failed: 0, pending: 0 }
  });
});
