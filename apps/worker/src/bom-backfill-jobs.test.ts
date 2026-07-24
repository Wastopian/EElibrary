/**
 * File header: Tests BOM backfill decision rules, queue claiming, and terminal persistence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import {
  decideBomBackfillLookupOutcome,
  processBomBackfillRequests,
  processNextBomBackfillRequest,
  setBomBackfillImportRunnerForTests,
  setBomBackfillLookupRunnerForTests
} from "./bom-backfill-jobs";
import type { Pool } from "pg";
import type { ProviderLookupCandidateBase } from "@ee-library/shared/types";
import type { ImportResultSummary } from "./provider-part-import";

/** TestPool is the pg-mem pool shape used by BOM backfill worker tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it. */
  end: () => Promise<void>;
};

test("backfill decision: zero candidates is an honest no_match", () => {
  assert.deepEqual(decideBomBackfillLookupOutcome([], null), { kind: "no_match" });
});

test("backfill decision: sub-1 confidence candidates never auto-import", () => {
  const outcome = decideBomBackfillLookupOutcome([buildCandidate({ matchConfidence: 0.9 })], null);

  assert.deepEqual(outcome, { kind: "no_match" });
});

test("backfill decision: one exact candidate imports", () => {
  const outcome = decideBomBackfillLookupOutcome([buildCandidate({})], null);

  assert.equal(outcome.kind, "acquire");
  assert.equal(outcome.kind === "acquire" ? outcome.candidate.providerPartKey : null, "C1091");
});

test("backfill decision: same identity across providers imports the first provider in registry order", () => {
  const outcome = decideBomBackfillLookupOutcome(
    [
      buildCandidate({ providerId: "jlcparts", providerPartKey: "C1091" }),
      // Punctuation and case variants of the same identity must not read as a conflict.
      buildCandidate({ manufacturerName: "YAGEO-Corp", mpn: "rc0402fr-0710kl", providerId: "mouser", providerPartKey: "603-RC0402FR-0710KL" })
    ],
    null
  );

  assert.equal(outcome.kind, "acquire");
  assert.equal(outcome.kind === "acquire" ? outcome.candidate.providerId : null, "jlcparts");
});

test("backfill decision: differing identities park as needs_choice with candidates preserved", () => {
  const outcome = decideBomBackfillLookupOutcome(
    [
      buildCandidate({}),
      buildCandidate({ manufacturerName: "Vishay", mpn: "CRCW040210K0FK", providerId: "mouser", providerPartKey: "71-CRCW0402" })
    ],
    null
  );

  assert.equal(outcome.kind, "needs_choice");
  assert.equal(outcome.kind === "needs_choice" ? outcome.candidates.length : 0, 2);
});

test("backfill decision: a BOM manufacturer that matches no candidate is a human decision", () => {
  const outcome = decideBomBackfillLookupOutcome([buildCandidate({})], "Vishay");

  assert.equal(outcome.kind, "needs_choice");
});

test("backfill decision: a BOM manufacturer filters to the agreeing candidate", () => {
  const outcome = decideBomBackfillLookupOutcome(
    [
      buildCandidate({}),
      buildCandidate({ manufacturerName: "Vishay", mpn: "CRCW040210K0FK", providerId: "mouser", providerPartKey: "71-CRCW0402" })
    ],
    "YAGEO Corp"
  );

  assert.equal(outcome.kind, "acquire");
  assert.equal(outcome.kind === "acquire" ? outcome.candidate.manufacturerName : null, "YAGEO Corp");
});

test("backfill worker claims the oldest queued request, imports the agreed candidate, and enqueues enrichment", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartRow(pool, "part-jlcparts-c1091");
  await seedQueuedRequest(pool, "bomfill-older", "2026-07-16T12:00:00.000Z", "RC0402FR-0710KL", "YAGEO Corp");
  await seedQueuedRequest(pool, "bomfill-newer", "2026-07-16T12:05:00.000Z", "GRM155R71C104KA88D", null);
  let capturedOrgId: string | undefined;
  let capturedProviderPartId: string | undefined;

  setBomBackfillLookupRunnerForTests(async () => ({ candidates: [buildCandidate({})], failures: [] }));
  setBomBackfillImportRunnerForTests(async (_providerId, request, orgId) => {
    capturedOrgId = orgId;
    capturedProviderPartId = request.providerPartId;
    return buildImportSummary("part-jlcparts-c1091", "C1091");
  });

  try {
    const result = await processNextBomBackfillRequest();
    const settled = await pool.query<{ request_status: string; part_id: string | null; completed_at: Date | null }>(
      "SELECT request_status, part_id, completed_at FROM bom_backfill_requests WHERE id = 'bomfill-older'"
    );
    const untouched = await pool.query<{ request_status: string }>(
      "SELECT request_status FROM bom_backfill_requests WHERE id = 'bomfill-newer'"
    );
    const enrichmentJobs = await pool.query<{ part_id: string }>("SELECT part_id FROM provider_enrichment_jobs");

    assert.deepEqual(result, { mpn: "RC0402FR-0710KL", requestId: "bomfill-older", status: "imported" });
    assert.equal(capturedOrgId, "org-acme", "the worker threads the request's org to the part import");
    assert.equal(capturedProviderPartId, "C1091");
    assert.equal(settled.rows[0]?.request_status, "imported");
    assert.equal(settled.rows[0]?.part_id, "part-jlcparts-c1091");
    assert.ok(settled.rows[0]?.completed_at);
    assert.equal(untouched.rows[0]?.request_status, "queued");
    assert.equal(enrichmentJobs.rows[0]?.part_id, "part-jlcparts-c1091");
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setBomBackfillImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("backfill worker reuses an existing catalog part without re-importing", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartRow(pool, "part-already-imported", "org-acme");
  await pool.query(
    "INSERT INTO source_records (id, provider_id, provider_part_key, part_id, fetched_at, org_id) VALUES ('src-1', 'jlcparts', 'C1091', 'part-already-imported', '2026-07-01T00:00:00.000Z', 'org-acme')"
  );
  await seedQueuedRequest(pool, "bomfill-existing", "2026-07-16T12:00:00.000Z", "RC0402FR-0710KL", null);
  let importCalled = false;

  setBomBackfillLookupRunnerForTests(async () => ({ candidates: [buildCandidate({})], failures: [] }));
  setBomBackfillImportRunnerForTests(async () => {
    importCalled = true;
    return buildImportSummary("part-should-not-import", "C1091");
  });

  try {
    const result = await processNextBomBackfillRequest();
    const settled = await pool.query<{ request_status: string; part_id: string | null }>(
      "SELECT request_status, part_id FROM bom_backfill_requests WHERE id = 'bomfill-existing'"
    );

    assert.deepEqual(result, { mpn: "RC0402FR-0710KL", requestId: "bomfill-existing", status: "imported" });
    assert.equal(importCalled, false, "an existing catalog part short-circuits the provider import");
    assert.equal(settled.rows[0]?.part_id, "part-already-imported");
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setBomBackfillImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("backfill worker never reuses another organization's provider source", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartRow(pool, "part-foreign", "org-default");
  await seedPartRow(pool, "org-acme__part-jlcparts-c1091", "org-acme");
  await pool.query(
    "INSERT INTO source_records (id, provider_id, provider_part_key, part_id, fetched_at, org_id) VALUES ('src-foreign', 'jlcparts', 'C1091', 'part-foreign', '2026-07-01T00:00:00.000Z', 'org-default')"
  );
  await seedQueuedRequest(pool, "bomfill-acme", "2026-07-16T12:00:00.000Z", "RC0402FR-0710KL", null);
  let capturedOrgId: string | undefined;
  let importCalled = false;

  setBomBackfillLookupRunnerForTests(async () => ({ candidates: [buildCandidate({})], failures: [] }));
  setBomBackfillImportRunnerForTests(async (_providerId, _request, orgId) => {
    capturedOrgId = orgId;
    importCalled = true;
    return buildImportSummary("org-acme__part-jlcparts-c1091", "C1091");
  });

  try {
    const result = await processNextBomBackfillRequest();
    const settled = await pool.query<{ request_status: string; part_id: string | null }>(
      "SELECT request_status, part_id FROM bom_backfill_requests WHERE id = 'bomfill-acme'"
    );

    assert.deepEqual(result, { mpn: "RC0402FR-0710KL", requestId: "bomfill-acme", status: "imported" });
    assert.equal(importCalled, true, "a foreign source must not short-circuit the tenant-scoped import");
    assert.equal(capturedOrgId, "org-acme");
    assert.equal(settled.rows[0]?.part_id, "org-acme__part-jlcparts-c1091");
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setBomBackfillImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("backfill worker parks ambiguity as needs_choice with candidates persisted, and empty lookups as no_match", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedQueuedRequest(pool, "bomfill-ambiguous", "2026-07-16T12:00:00.000Z", "10K-0402", null);
  await seedQueuedRequest(pool, "bomfill-missing", "2026-07-16T12:05:00.000Z", "NO-SUCH-PART", null);
  const ambiguous = [
    buildCandidate({}),
    buildCandidate({ manufacturerName: "Vishay", mpn: "CRCW040210K0FK", providerId: "mouser", providerPartKey: "71-CRCW0402" })
  ];

  setBomBackfillLookupRunnerForTests(async (request) => ({ candidates: request.query === "10K-0402" ? ambiguous : [], failures: [] }));
  setBomBackfillImportRunnerForTests(async () => {
    throw new Error("import must not run for parked rows");
  });

  try {
    const summary = await processBomBackfillRequests(10, 1);
    const parked = await pool.query<{ request_status: string; candidates: unknown }>(
      "SELECT request_status, candidates FROM bom_backfill_requests WHERE id = 'bomfill-ambiguous'"
    );
    const missing = await pool.query<{ request_status: string }>(
      "SELECT request_status FROM bom_backfill_requests WHERE id = 'bomfill-missing'"
    );

    assert.deepEqual(
      summary.processed.map((row) => row.status),
      ["needs_choice", "no_match"]
    );
    assert.equal(parked.rows[0]?.request_status, "needs_choice");
    const persistedCandidates = parked.rows[0]?.candidates;
    const parsedCandidates = typeof persistedCandidates === "string" ? JSON.parse(persistedCandidates) : persistedCandidates;
    assert.equal(Array.isArray(parsedCandidates) ? parsedCandidates.length : 0, 2);
    assert.equal(missing.rows[0]?.request_status, "no_match");
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setBomBackfillImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("backfill worker never claims no_match when a provider errored instead of answering", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedQueuedRequest(pool, "bomfill-outage", "2026-07-16T12:00:00.000Z", "RC0402FR-0710KL", null);

  setBomBackfillLookupRunnerForTests(async () => ({
    candidates: [],
    failures: [{ message: "Unable to fetch DigiKey response (401)", providerId: "digikey", providerName: "DigiKey" }]
  }));

  try {
    const result = await processNextBomBackfillRequest();
    const failed = await pool.query<{ request_status: string; error_code: string | null; error_message: string | null }>(
      "SELECT request_status, error_code, error_message FROM bom_backfill_requests WHERE id = 'bomfill-outage'"
    );

    assert.deepEqual(result, { mpn: "RC0402FR-0710KL", requestId: "bomfill-outage", status: "failed" });
    assert.equal(failed.rows[0]?.error_code, "PROVIDER_UNAVAILABLE");
    assert.match(failed.rows[0]?.error_message ?? "", /digikey did not answer/u);
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("backfill worker still imports when a responding provider agrees despite another provider's outage", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartRow(pool, "part-jlcparts-c1091");
  await seedQueuedRequest(pool, "bomfill-partial-outage", "2026-07-16T12:00:00.000Z", "RC0402FR-0710KL", null);

  setBomBackfillLookupRunnerForTests(async () => ({
    candidates: [buildCandidate({})],
    failures: [{ message: "Unable to fetch DigiKey response (401)", providerId: "digikey", providerName: "DigiKey" }]
  }));
  setBomBackfillImportRunnerForTests(async () => buildImportSummary("part-jlcparts-c1091", "C1091"));

  try {
    const result = await processNextBomBackfillRequest();

    assert.deepEqual(result, { mpn: "RC0402FR-0710KL", requestId: "bomfill-partial-outage", status: "imported" });
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setBomBackfillImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("backfill worker maps provider failures to stable codes and calm copy", async () => {
  const pool = createBomBackfillPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedQueuedRequest(pool, "bomfill-creds", "2026-07-16T12:00:00.000Z", "RC0402FR-0710KL", null);

  setBomBackfillLookupRunnerForTests(async () => {
    throw new Error("Mouser credentials are not configured");
  });

  try {
    const result = await processNextBomBackfillRequest();
    const failed = await pool.query<{ request_status: string; error_code: string | null; error_message: string | null }>(
      "SELECT request_status, error_code, error_message FROM bom_backfill_requests WHERE id = 'bomfill-creds'"
    );

    assert.deepEqual(result, { mpn: "RC0402FR-0710KL", requestId: "bomfill-creds", status: "failed" });
    assert.equal(failed.rows[0]?.request_status, "failed");
    assert.equal(failed.rows[0]?.error_code, "PROVIDER_CREDENTIALS_MISSING");
    assert.match(failed.rows[0]?.error_message ?? "", /MOUSER_API_KEY/u);
  } finally {
    setBomBackfillLookupRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds one exact provider lookup candidate with sensible defaults for override-only tests.
 */
function buildCandidate(overrides: Partial<ProviderLookupCandidateBase>): ProviderLookupCandidateBase {
  return {
    manufacturerName: "YAGEO Corp",
    matchConfidence: 1,
    matchType: "exact_mpn",
    mpn: "RC0402FR-0710KL",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    sourceUrl: "https://lcsc.com/product-detail/example",
    ...overrides
  };
}

/**
 * Builds one successful import summary matching the shared worker contract.
 */
function buildImportSummary(partId: string, providerPartKey: string): ImportResultSummary {
  return {
    durationMs: 1,
    importStatus: "imported",
    outcome: "new_import",
    partId,
    previousImportStatus: null,
    providerId: "jlcparts",
    providerPartKey,
    requestedLookup: providerPartKey,
    sourceLastImportedAt: "2026-07-16T12:00:05.000Z",
    sourceLastSeenAt: "2026-07-16T12:00:05.000Z",
    timings: []
  };
}

/**
 * Creates the minimal pg-mem schema the backfill worker touches.
 */
function createBomBackfillPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '',
      org_id TEXT DEFAULT 'org-default'
    );
    CREATE TABLE source_records (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      part_id TEXT,
      fetched_at TIMESTAMPTZ NOT NULL,
      org_id TEXT DEFAULT 'org-default'
    );
    CREATE TABLE bom_backfill_requests (
      id TEXT PRIMARY KEY,
      bom_import_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      mpn TEXT NOT NULL,
      manufacturer_name TEXT,
      request_status TEXT NOT NULL DEFAULT 'queued',
      candidates JSONB NOT NULL DEFAULT '[]',
      part_id TEXT,
      error_code TEXT,
      error_message TEXT,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_updated_at TIMESTAMPTZ NOT NULL,
      org_id TEXT
    );
    CREATE TABLE provider_enrichment_jobs (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      source_acquisition_job_id TEXT,
      job_type TEXT NOT NULL,
      job_status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_code TEXT,
      error_message TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE provider_enrichment_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      file_format TEXT NOT NULL,
      storage_key TEXT,
      file_hash TEXT,
      provider_id TEXT,
      license_mode TEXT NOT NULL,
      provenance TEXT NOT NULL,
      availability_status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      export_status TEXT NOT NULL,
      asset_status TEXT NOT NULL,
      generation_method TEXT,
      generation_source_asset_id TEXT,
      validation_status TEXT NOT NULL,
      preview_status TEXT NOT NULL,
      preview_artifact_storage_key TEXT,
      preview_artifact_format TEXT,
      preview_artifact_generated_at TIMESTAMPTZ,
      preview_artifact_source TEXT,
      asset_state TEXT NOT NULL,
      source_url TEXT,
      source_record_id TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Inserts one canonical part row so enrichment enqueues can reference it safely.
 */
async function seedPartRow(pool: TestPool, partId: string, orgId = "org-default"): Promise<void> {
  await pool.query("INSERT INTO parts (id, org_id) VALUES ($1, $2)", [partId, orgId]);
}

/**
 * Inserts one queued backfill request for a non-default org so org threading stays visible.
 */
async function seedQueuedRequest(pool: TestPool, requestId: string, requestedAt: string, mpn: string, manufacturerName: string | null): Promise<void> {
  await pool.query(
    `
      INSERT INTO bom_backfill_requests (
        id, bom_import_id, project_id, mpn, manufacturer_name, request_status,
        requested_by, requested_at, last_updated_at, org_id
      )
      VALUES ($1, 'bomimp-1', 'proj-1', $2, $3, 'queued', 'admin-user', $4, $4, 'org-acme')
    `,
    [requestId, mpn, manufacturerName, requestedAt]
  );
}
