/**
 * File header: Tests stale supply-offer refresh selection and provider runner behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import { refreshStaleSupplyOfferSnapshots, setSupplyOfferRefreshImportRunnerForTests } from "./supply-offer-refresh";
import type { Pool } from "pg";
import type { ImportResultSummary, ProviderPartRequest } from "./provider-part-import";

/** TestPool is the pg-mem pool shape used by stale supply refresh tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the repository override releases it. */
  end: () => Promise<void>;
};

/**
 * Verifies stale active supply rows are refreshed by source record, while fresh and retired rows stay idle.
 */
test("refreshStaleSupplyOfferSnapshots refreshes stale active source rows only", async () => {
  const pool = createSupplyRefreshPool();
  const calls: Array<{ adapterId: string; request: ProviderPartRequest; orgId?: string }> = [];
  setWorkerRepositoryPoolForTests(pool);
  setSupplyOfferRefreshImportRunnerForTests(async (adapterId, request, orgId) => {
    calls.push(orgId === undefined ? { adapterId, request } : { adapterId, orgId, request });

    return buildImportSummary(adapterId, request);
  });

  try {
    const summary = await refreshStaleSupplyOfferSnapshots({
      limit: 10,
      now: new Date("2026-05-01T00:00:00.000Z"),
      staleAfterDays: 14
    });

    assert.equal(summary.checkedCount, 2);
    assert.equal(summary.refreshedCount, 1);
    assert.equal(summary.skippedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.deepEqual(calls, [
      {
        adapterId: "jlcparts",
        orgId: "org-default",
        request: {
          providerPartId: "C1091",
          providerUrl: "https://lcsc.com/product-detail/test_C1091.html"
        }
      }
    ]);
    assert.equal(summary.results.find((result) => result.providerId === "legacy-provider")?.status, "skipped_unsupported_provider");
  } finally {
    setSupplyOfferRefreshImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a non-default tenant's stale offer refreshes under that org — never org-default.
 * Without org threading, worker RLS bypass + the import default would create/update default-org rows
 * while the requesting tenant's offers stayed stale forever.
 */
test("refreshStaleSupplyOfferSnapshots threads the source org into the import runner", async () => {
  const pool = createSupplyRefreshPool({
    includeNonDefaultOrg: true
  });
  const calls: Array<{ adapterId: string; request: ProviderPartRequest; orgId?: string }> = [];
  setWorkerRepositoryPoolForTests(pool);
  setSupplyOfferRefreshImportRunnerForTests(async (adapterId, request, orgId) => {
    calls.push(orgId === undefined ? { adapterId, request } : { adapterId, orgId, request });

    return buildImportSummary(adapterId, request);
  });

  try {
    const summary = await refreshStaleSupplyOfferSnapshots({
      limit: 10,
      now: new Date("2026-05-01T00:00:00.000Z"),
      staleAfterDays: 14
    });

    const acmeRefresh = calls.find((call) => call.request.providerPartId === "C4091");
    assert.ok(acmeRefresh, "expected the non-default org's stale source to be selected");
    assert.equal(acmeRefresh.orgId, "org-acme");
    assert.equal(
      summary.results.find((result) => result.providerPartKey === "C4091")?.status,
      "refreshed"
    );
  } finally {
    setSupplyOfferRefreshImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds a successful import summary for the refresh runner stub.
 */
function buildImportSummary(adapterId: string, request: ProviderPartRequest): ImportResultSummary {
  return {
    durationMs: 1,
    importStatus: "imported",
    outcome: "refreshed_existing",
    partId: `part-${adapterId}`,
    previousImportStatus: "imported",
    providerId: adapterId,
    providerPartKey: request.providerPartId ?? "unknown",
    requestedLookup: request.providerPartId ?? "unknown",
    sourceLastImportedAt: "2026-05-01T00:00:00.000Z",
    sourceLastSeenAt: "2026-05-01T00:00:00.000Z",
    timings: []
  };
}

/** SupplyRefreshPoolOptions controls optional tenant fixtures for org-scoping regressions. */
interface SupplyRefreshPoolOptions {
  /** When true, adds a stale source owned by org-acme alongside the default-org fixtures. */
  includeNonDefaultOrg?: boolean;
}

/**
 * Creates an in-memory schema with stale, fresh, retired, and unsupported-provider supply rows.
 */
function createSupplyRefreshPool(options: SupplyRefreshPoolOptions = {}): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE source_records (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      part_id TEXT,
      org_id TEXT,
      source_url TEXT,
      import_status TEXT NOT NULL
    );

    CREATE TABLE supply_offerings (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      supplier_name TEXT,
      provider_sku TEXT,
      inventory_status TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      retired_at TIMESTAMPTZ,
      retirement_reason TEXT
    );

    INSERT INTO source_records (id, provider_id, provider_part_key, part_id, org_id, source_url, import_status)
    VALUES
      ('source-stale-jlc', 'jlcparts', 'C1091', 'part-alpha', 'org-default', 'https://lcsc.com/product-detail/test_C1091.html', 'imported'),
      ('source-fresh-jlc', 'jlcparts', 'C2000', 'part-beta', 'org-default', 'https://lcsc.com/product-detail/test_C2000.html', 'imported'),
      ('source-retired-jlc', 'jlcparts', 'C3000', 'part-gamma', 'org-default', 'https://lcsc.com/product-detail/test_C3000.html', 'imported'),
      ('source-unsupported', 'legacy-provider', 'LEGACY-1', 'part-delta', 'org-default', 'https://example.test/legacy', 'imported');

    INSERT INTO supply_offerings (id, part_id, provider_id, source_record_id, provider_part_key, supplier_name, provider_sku, inventory_status, last_seen_at, retired_at, retirement_reason)
    VALUES
      ('offer-stale-jlc', 'part-alpha', 'jlcparts', 'source-stale-jlc', 'C1091', 'LCSC', 'C1091', 'in_stock', '2026-04-01T00:00:00.000Z', NULL, NULL),
      ('offer-fresh-jlc', 'part-beta', 'jlcparts', 'source-fresh-jlc', 'C2000', 'LCSC', 'C2000', 'in_stock', '2026-04-25T00:00:00.000Z', NULL, NULL),
      ('offer-retired-jlc', 'part-gamma', 'jlcparts', 'source-retired-jlc', 'C3000', 'LCSC', 'C3000', 'in_stock', '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z', 'missing_from_latest_provider_snapshot'),
      ('offer-unsupported', 'part-delta', 'legacy-provider', 'source-unsupported', 'LEGACY-1', 'Legacy Seller', 'LEGACY-1', 'unknown', '2026-04-01T00:00:00.000Z', NULL, NULL);
  `);

  if (options.includeNonDefaultOrg) {
    db.public.none(`
      INSERT INTO source_records (id, provider_id, provider_part_key, part_id, org_id, source_url, import_status)
      VALUES
        ('org-acme__source-stale-jlc', 'jlcparts', 'C4091', 'org-acme__part-alpha', 'org-acme', 'https://lcsc.com/product-detail/test_C4091.html', 'imported');

      INSERT INTO supply_offerings (id, part_id, provider_id, source_record_id, provider_part_key, supplier_name, provider_sku, inventory_status, last_seen_at, retired_at, retirement_reason)
      VALUES
        ('org-acme__offer-stale-jlc', 'org-acme__part-alpha', 'jlcparts', 'org-acme__source-stale-jlc', 'C4091', 'LCSC', 'C4091', 'in_stock', '2026-04-01T00:00:00.000Z', NULL, NULL);
    `);
  }

  const adapter = db.adapters.createPg();
  return new adapter.Pool() as TestPool;
}
