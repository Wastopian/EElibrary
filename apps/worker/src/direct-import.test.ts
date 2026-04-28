/**
 * File header: Tests runDirectImport against fake provider adapters and a stubbed pg pool so we
 * exercise the success / already-existed / provider-not-found / fetch-failed branches without
 * needing a live Postgres or HTTP provider.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runDirectImport } from "./direct-import";
import { providerAdapters, type NormalizedProviderPart, type ProviderAdapter } from "./provider-adapters";

interface FakePoolCall {
  text: string;
  values: unknown[];
}

/**
 * Builds a minimum NormalizedProviderPart fixture for persistence tests.
 */
function buildNormalized(partId: string, mpn: string): NormalizedProviderPart {
  const lastUpdatedAt = "2026-04-26T00:00:00.000Z";
  return {
    assets: [],
    datasheetRevisions: [],
    manufacturer: { aliases: [], id: "mfr-test", name: "Test", website: null },
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "pkg-test",
      packageName: "TEST",
      pinCount: null,
      pitchMm: null
    },
    part: {
      category: "test",
      id: partId,
      lastUpdatedAt,
      lifecycleStatus: "active",
      manufacturerId: "mfr-test",
      mpn,
      packageId: "pkg-test",
      trustScore: 0.5
    },
    sourceRecord: {
      fetchedAt: lastUpdatedAt,
      id: `source-test-${partId}`,
      lastUpdatedAt,
      normalizedAt: lastUpdatedAt,
      partId,
      providerId: "test-provider",
      providerPartKey: mpn,
      rawPayload: { mpn },
      sourceUrl: null
    }
  };
}

/**
 * Installs a fake adapter into the provider registry for the duration of a single test
 * and removes it afterward, then yields the calls made against a stubbed pg.Pool.
 */
async function withFakeProvider(
  adapter: ProviderAdapter,
  options: {
    existingPartIds?: Set<string>;
    persistShouldFail?: boolean;
  },
  body: (pool: unknown, capturedCalls: FakePoolCall[]) => Promise<void>
): Promise<void> {
  providerAdapters.push(adapter);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://stub-not-used";

  const calls: FakePoolCall[] = [];
  const fakePool = makeFakePool(calls, options);

  try {
    await body(fakePool, calls);
  } finally {
    const index = providerAdapters.lastIndexOf(adapter);
    if (index >= 0) {
      providerAdapters.splice(index, 1);
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}

/**
 * Builds a minimal pg.Pool stub that captures executed queries.
 */
function makeFakePool(calls: FakePoolCall[], options: { existingPartIds?: Set<string>; persistShouldFail?: boolean }) {
  const fakePool = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      const trimmed = text.trim();

      if (trimmed.startsWith("SELECT id FROM parts WHERE id")) {
        const partId = String(values[0]);
        const exists = options.existingPartIds?.has(partId) ?? false;
        return { rowCount: exists ? 1 : 0, rows: exists ? [{ id: partId }] : [] };
      }

      if (options.persistShouldFail && trimmed.toUpperCase().startsWith("INSERT INTO MANUFACTURERS")) {
        throw new Error("simulated persist failure");
      }

      return { rowCount: 0, rows: [] };
    },
    async connect() {
      return {
        query: fakePool.query,
        release() {
          /* no-op */
        }
      };
    }
  };

  return fakePool as unknown;
}

test("runDirectImport returns imported when the provider yields a fresh part", async () => {
  const adapter: ProviderAdapter = {
    async fetchRawPart() {
      return { fetchedAt: "2026-04-26T00:00:00.000Z", payload: {}, providerId: "test-provider" };
    },
    id: "test-provider",
    async listAvailablePartRequests() {
      return [];
    },
    name: "Test provider",
    normalizeRawPart() {
      return buildNormalized("part-test-fresh", "TEST-FRESH-1");
    }
  };

  await withFakeProvider(adapter, {}, async (pool) => {
    const result = await runDirectImport({ mpn: "TEST-FRESH-1", providerId: "test-provider" }, { pool: pool as never });

    assert.equal(result.status, "imported");
    if (result.status === "imported") {
      assert.equal(result.partId, "part-test-fresh");
      assert.equal(result.mpn, "TEST-FRESH-1");
      assert.equal(result.providerId, "test-provider");
      assert.equal(result.alreadyExisted, false);
    }
  });
});

test("runDirectImport reports alreadyExisted when the part is in the catalog", async () => {
  const adapter: ProviderAdapter = {
    async fetchRawPart() {
      return { fetchedAt: "2026-04-26T00:00:00.000Z", payload: {}, providerId: "test-provider" };
    },
    id: "test-provider",
    async listAvailablePartRequests() {
      return [];
    },
    name: "Test provider",
    normalizeRawPart() {
      return buildNormalized("part-test-existing", "TEST-EXISTING-1");
    }
  };

  await withFakeProvider(adapter, { existingPartIds: new Set(["part-test-existing"]) }, async (pool) => {
    const result = await runDirectImport({ mpn: "TEST-EXISTING-1", providerId: "test-provider" }, { pool: pool as never });

    assert.equal(result.status, "imported");
    if (result.status === "imported") {
      assert.equal(result.alreadyExisted, true);
    }
  });
});

test("runDirectImport returns provider_not_registered for unknown provider ids", async () => {
  const result = await runDirectImport({ mpn: "DOES-NOT-MATTER-1", providerId: "no-such-provider" });
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "provider_not_registered");
    assert.equal(result.providerId, "no-such-provider");
  }
});

test("runDirectImport classifies provider not-found responses as provider_part_not_found", async () => {
  const adapter: ProviderAdapter = {
    async fetchRawPart() {
      throw new Error("Local catalog part not found: NOPE-1");
    },
    id: "test-provider-missing",
    async listAvailablePartRequests() {
      return [];
    },
    name: "Test provider",
    normalizeRawPart() {
      throw new Error("normalize should not be called when fetch failed");
    }
  };

  await withFakeProvider(adapter, {}, async () => {
    const result = await runDirectImport({ mpn: "NOPE-1", providerId: "test-provider-missing" });
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.reason, "provider_part_not_found");
      assert.match(result.message, /not found/iu);
    }
  });
});

test("runDirectImport classifies generic provider errors as provider_fetch_failed", async () => {
  const adapter: ProviderAdapter = {
    async fetchRawPart() {
      throw new Error("HTTP 500 from upstream");
    },
    id: "test-provider-failing",
    async listAvailablePartRequests() {
      return [];
    },
    name: "Test provider",
    normalizeRawPart() {
      throw new Error("normalize should not be called when fetch failed");
    }
  };

  await withFakeProvider(adapter, {}, async () => {
    const result = await runDirectImport({ mpn: "FAIL-1", providerId: "test-provider-failing" });
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.reason, "provider_fetch_failed");
    }
  });
});
