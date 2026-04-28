/**
 * File header: Tests the web api-client by stubbing global fetch. Exercises the success,
 * provider-failure, and network-error branches that drive the import CTA copy.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { fetchSystemHealth, importExactMpn } from "./api-client";

interface FetchCall {
  input: string;
  init: RequestInit | undefined;
}

/**
 * Replaces global fetch for the duration of one test and returns captured calls plus a restore fn.
 */
function stubFetch(handler: (call: FetchCall) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>) {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ init, input: url });
    const result = await handler({ init, input: url });
    return new Response(JSON.stringify(result.body), {
      headers: { "Content-Type": "application/json" },
      status: result.status
    });
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

test("importExactMpn returns imported on a successful response", async () => {
  const stub = stubFetch(async () => ({
    body: {
      alreadyExisted: false,
      mpn: "TPS7A02DBVR",
      partId: "part-tps7a02dbvr",
      providerId: "local-catalog",
      status: "imported"
    },
    status: 201
  }));

  try {
    const result = await importExactMpn("TPS7A02DBVR");
    assert.equal(result.status, "imported");
    if (result.status === "imported") {
      assert.equal(result.partId, "part-tps7a02dbvr");
    }
    const lastCall = stub.calls.at(-1);
    assert.ok(lastCall?.input.endsWith("/parts/import"));
    assert.equal(lastCall?.init?.method, "POST");
    const body = JSON.parse(String(lastCall?.init?.body));
    assert.equal(body.mpn, "TPS7A02DBVR");
  } finally {
    stub.restore();
  }
});

test("importExactMpn surfaces provider_part_not_found with the API message", async () => {
  const stub = stubFetch(async () => ({
    body: {
      message: "Local catalog part not found: NOPE-1",
      mpn: "NOPE-1",
      providerId: "local-catalog",
      reason: "provider_part_not_found",
      status: "failed"
    },
    status: 404
  }));

  try {
    const result = await importExactMpn("NOPE-1");
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.reason, "provider_part_not_found");
      assert.equal(result.httpStatus, 404);
      assert.match(result.message, /not found/iu);
    }
  } finally {
    stub.restore();
  }
});

test("importExactMpn returns network_error when fetch throws", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  try {
    const result = await importExactMpn("TPS7A02DBVR");
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.reason, "network_error");
      assert.equal(result.httpStatus, 0);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("importExactMpn forwards providerId when supplied", async () => {
  const stub = stubFetch(async () => ({
    body: {
      alreadyExisted: false,
      mpn: "TPS7A02DBVR",
      partId: "part-tps7a02dbvr",
      providerId: "local-catalog",
      status: "imported"
    },
    status: 201
  }));

  try {
    await importExactMpn("TPS7A02DBVR", "local-catalog");
    const body = JSON.parse(String(stub.calls.at(-1)?.init?.body));
    assert.equal(body.providerId, "local-catalog");
  } finally {
    stub.restore();
  }
});

test("fetchSystemHealth returns parsed payload on 200", async () => {
  const stub = stubFetch(async () => ({
    body: {
      api: { status: "ok" },
      database: { status: "connected" },
      objectStorage: { status: "not_configured" },
      queues: { acquisition: { failed: 0, pending: 0 }, enrichment: { failed: 0, pending: 0 } },
      worker: { lastSeenAt: null, staleAfterSeconds: 30, status: "offline" }
    },
    status: 200
  }));

  try {
    const health = await fetchSystemHealth();
    assert.notEqual(health, null);
    assert.equal(health?.worker.status, "offline");
  } finally {
    stub.restore();
  }
});

test("fetchSystemHealth returns null when fetch fails", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("ECONNREFUSED");
  }) as typeof fetch;

  try {
    const health = await fetchSystemHealth();
    assert.equal(health, null);
  } finally {
    globalThis.fetch = original;
  }
});
