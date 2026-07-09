/**
 * File header: Tests DB-backed API reads for a real-provider canonical import shape.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { buildPartDetailResponse } from "./detail-response";
import { readPartAcquisitionSummaryFromDatabase, readPartDetailRecordsFromDatabase, readPartEnrichmentSummaryFromDatabase, readPartParametersFromDatabase, readPartSearchFacetsFromDatabase, readPartSearchRecordsFromDatabase, readPartSpecificationsFromDatabase, setCatalogStorePoolForTests } from "./catalog-store";
import { enterRequestContextForTests, runWithRequestContext } from "./request-context";
import type { CatalogQueryTiming } from "./catalog-store";
import type { Pool, PoolClient } from "pg";

/** TestPool is the pg-mem pool shape used by catalog-store tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it from catalog-store. */
  end: () => Promise<void>;
};

/** ProviderImportPoolOptions lets focused tests turn acquisition-job fixtures on or off. */
interface ProviderImportPoolOptions {
  /** True when the canonical imported-part fixture should also include a succeeded acquisition job row. */
  includeAcquisitionJobs?: boolean;
  /** True when the canonical imported-part fixture should also include enrichment job history. */
  includeEnrichmentJobs?: boolean;
}

/**
 * Verifies imported provider-neutral rows are visible through DB-backed search and detail reads.
 */
test("DB-backed search and detail can read a jlcparts imported metadata record", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    const searchResult = await readPartSearchRecordsFromDatabase({ query: "RC-02W300JT" });
    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");

    assert.equal(searchResult.status, "available");
    assert.equal(detailResult.status, "available");

    if (searchResult.status !== "available" || detailResult.status !== "available") {
      throw new Error("expected DB-backed records");
    }

    assert.equal(searchResult.pagination.totalRecords, 1);
    assert.equal(searchResult.pagination.page, 1);

    const searchRecord = searchResult.records.find((record) => record.part.id === "part-jlcparts-c1091");
    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(searchRecord, "expected imported record in DB-backed search");
    assert.ok(detailRecord, "expected imported record in DB-backed detail");
    assert.equal(searchRecord.manufacturer.name, "Guangdong Fenghua Advanced Tech");
    assert.equal(searchRecord.sources[0]?.providerId, "jlcparts");
    assert.equal(searchRecord.sources[0]?.importStatus, "imported");
    assert.equal(searchRecord.sources[0]?.sourceLastImportedAt, "2026-04-12T06:57:40.000Z");
    assert.equal(searchRecord.extractionSignals.find((signal) => signal.signalType === "package_mechanical_dimensions")?.extractionStatus, "needs_review");
    assert.equal(searchRecord.metrics.length, 0);
    assert.equal(searchRecord.readinessSummary.status, "blocked");
    assert.equal(searchRecord.readinessSummary.connectorClass, "non_connector");
    assert.equal(searchRecord.approval.status, "not_requested");
    assert.equal(searchRecord.issues.some((issue) => issue.code === "missing_verified_cad"), true);
    assert.equal(searchRecord.riskFlags.some((flag) => flag.code === "partial_readiness_data"), true);
    assert.equal(detailRecord.metrics.find((metric) => metric.metricKey === "resistance")?.metricValue, 30);

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records);
    const datasheetGroup = detailResponse.assetGroups.find((group) => group.assetType === "datasheet");

    assert.equal(datasheetGroup?.bestAsset?.availabilityStatus, "referenced");
    assert.equal(datasheetGroup?.bestAsset?.exportStatus, "not_exportable");
    assert.equal(detailResponse.bundleReadiness.state, "references_only");
    assert.match(detailResponse.bundleReadiness.reason, /no stored CAD files/u);
    assert.equal(detailResponse.generationOptions.find((option) => option.targetAssetType === "symbol")?.canRequest, false);
    assert.match(detailResponse.generationOptions.find((option) => option.targetAssetType === "footprint")?.reason ?? "", /Package\/mechanical dimensions extraction/u);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies distributor specification rows read back in grouped display order and flow into the
 * detail response, while an unknown part id resolves to an empty list.
 */
test("DB-backed detail carries distributor specification rows in grouped order", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    const specifications = await readPartSpecificationsFromDatabase("part-jlcparts-c1091");

    assert.deepEqual(
      specifications.map((row) => [row.specKey, row.specValue, row.specGroup]),
      [
        ["Power", "1/16W", "parametric"],
        ["Tolerance", "±5%", "parametric"],
        ["RoHS Status", "RoHS Compliant", "compliance"]
      ],
      "parametric rows sort before compliance, then by spec key"
    );

    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");
    assert.equal(detailResult.status, "available");
    if (detailResult.status !== "available") throw new Error("expected DB-backed records");

    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");
    assert.ok(detailRecord, "expected imported record in DB-backed detail");

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records, undefined, undefined, specifications);
    assert.equal(detailResponse.specifications.length, 3);
    assert.equal(detailResponse.specifications[0]?.specKey, "Power");

    assert.deepEqual(await readPartSpecificationsFromDatabase("part-does-not-exist"), []);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies reconciled parameters read back typed and flow into the detail response, while an unknown
 * part id resolves to an empty list.
 */
test("DB-backed detail carries reconciled typed parameters", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    const parameters = await readPartParametersFromDatabase("part-jlcparts-c1091");
    const byKey = new Map(parameters.map((parameter) => [parameter.paramKey, parameter]));

    assert.equal(parameters.length, 2);
    assert.equal(byKey.get("resistance")?.valueNumeric, 30);
    assert.equal(byKey.get("resistance")?.unit, "ohm");
    assert.equal(byKey.get("resistance")?.partType, "resistor");
    assert.equal(byKey.get("resistance")?.sources[0]?.providerId, "jlcparts");
    assert.equal(byKey.get("package")?.valueText, "0402");

    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");
    assert.equal(detailResult.status, "available");
    if (detailResult.status !== "available") throw new Error("expected DB-backed records");

    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");
    assert.ok(detailRecord, "expected imported record in DB-backed detail");

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records, undefined, undefined, [], parameters);
    assert.equal(detailResponse.parameters.length, 2);

    assert.deepEqual(await readPartParametersFromDatabase("part-does-not-exist"), []);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the catalog is tenant-scoped: a part owned by another org is invisible to this org's
 * search and detail reads, an anonymous (no-tenant) read sees nothing, and each org resolves only
 * its own copy of a shared MPN.
 */
test("tenant isolation: catalog search and detail are scoped to the request org", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    // A part owned by org-other, reusing the global manufacturer/package taxonomy of the seeded part.
    await pool.query(
      `INSERT INTO parts (id, mpn, description, manufacturer_id, category, lifecycle_status, package_id, connector_family_id, trust_score, org_id, last_updated_at)
       VALUES ('part-other-only', 'OTHER-ONLY-9000', 'Other org part', 'mfr-jlcparts-guangdong-fenghua-advanced-tech', 'Resistors / Chip Resistor - Surface Mount', 'active', 'pkg-jlcparts-0402', NULL, 0.5, 'org-other', '2026-04-12T06:57:40.000Z')`
    );

    // org-default (the harness default context) cannot see the org-other part.
    const ownSearch = await readPartSearchRecordsFromDatabase({ query: "OTHER-ONLY-9000" });
    assert.equal(ownSearch.status, "available");
    if (ownSearch.status !== "available") throw new Error("ownSearch unavailable");
    assert.equal(ownSearch.pagination.totalRecords, 0, "org-default cannot find the org-other part");

    const ownDetail = await readPartDetailRecordsFromDatabase("part-other-only");
    assert.equal(ownDetail.status, "available");
    if (ownDetail.status !== "available") throw new Error("ownDetail unavailable");
    assert.equal(ownDetail.records.length, 0, "org-default cannot read the org-other part detail");

    // org-other resolves its own part.
    await runWithRequestContext("org-other", async () => {
      const otherSearch = await readPartSearchRecordsFromDatabase({ query: "OTHER-ONLY-9000" });
      assert.equal(otherSearch.status, "available");
      if (otherSearch.status !== "available") throw new Error("otherSearch unavailable");
      assert.equal(otherSearch.pagination.totalRecords, 1, "org-other sees its own part");
      assert.ok(otherSearch.records.some((record) => record.part.id === "part-other-only"));

      // ...and not org-default's seeded part.
      const crossSearch = await readPartSearchRecordsFromDatabase({ query: "RC-02W300JT" });
      assert.equal(crossSearch.status, "available");
      if (crossSearch.status !== "available") throw new Error("crossSearch unavailable");
      assert.equal(crossSearch.pagination.totalRecords, 0, "org-other cannot see org-default's part");
    });

    // No tenant context fails closed: an anonymous read sees nothing.
    await runWithRequestContext(null, async () => {
      const anonymous = await readPartSearchRecordsFromDatabase({ query: "RC-02W300JT" });
      assert.equal(anonymous.status, "available");
      if (anonymous.status !== "available") throw new Error("anonymous unavailable");
      assert.equal(anonymous.pagination.totalRecords, 0, "no tenant => no catalog");
    });
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies detail reads expose the latest matching acquisition job summary for imported parts.
 */
test("DB-backed detail response includes acquisition summary for a matching provider acquisition job", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");
    const acquisitionSummary = await readPartAcquisitionSummaryFromDatabase("part-jlcparts-c1091");

    assert.equal(detailResult.status, "available");
    assert.equal(acquisitionSummary.state, "available");
    assert.equal(acquisitionSummary.providerId, "jlcparts");
    assert.equal(acquisitionSummary.providerPartKey, "C1091");
    assert.equal(acquisitionSummary.requestedLookup, "RC-02W300JT");
    assert.equal(acquisitionSummary.lastJobStatus, "succeeded");
    assert.equal(acquisitionSummary.requestedBy, null);

    if (detailResult.status !== "available") {
      throw new Error("expected DB-backed detail records");
    }

    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(detailRecord, "expected imported record in DB-backed detail");

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records, acquisitionSummary);

    assert.equal(detailResponse.acquisitionSummary.state, "available");
    assert.equal(detailResponse.acquisitionSummary.sourceUrl, "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies detail reads expose recorded enrichment summary for imported parts without changing readiness truth.
 */
test("DB-backed detail response includes enrichment summary for matching provider enrichment jobs", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);

    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");
    const acquisitionSummary = await readPartAcquisitionSummaryFromDatabase("part-jlcparts-c1091");
    const enrichmentSummary = await readPartEnrichmentSummaryFromDatabase("part-jlcparts-c1091");

    assert.equal(detailResult.status, "available");
    assert.equal(enrichmentSummary.state, "available");
    assert.equal(enrichmentSummary.latestJobStatus, "succeeded");
    assert.equal(enrichmentSummary.activeJobCount, 0);
    assert.equal(enrichmentSummary.jobs[0]?.jobType, "datasheet_capture");

    if (detailResult.status !== "available") {
      throw new Error("expected DB-backed detail records");
    }

    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(detailRecord, "expected imported record in DB-backed detail");

    const detailResponse = buildPartDetailResponse(
      detailRecord,
      detailResult.records,
      acquisitionSummary,
      enrichmentSummary
    );

    assert.equal(detailResponse.enrichmentSummary.state, "available");
    assert.equal(detailResponse.enrichmentSummary.jobs[0]?.jobType, "datasheet_capture");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies parts without enrichment jobs stay explicit instead of inventing background-work history.
 */
test("DB-backed detail enrichment summary returns not_recorded when no enrichment jobs exist", async () => {
  const pool = createProviderImportPool({ includeEnrichmentJobs: false });

  try {
    setCatalogStorePoolForTests(pool);

    const enrichmentSummary = await readPartEnrichmentSummaryFromDatabase("part-jlcparts-c1091");

    assert.equal(enrichmentSummary.state, "not_recorded");
    assert.equal(enrichmentSummary.jobs.length, 0);
    assert.match(enrichmentSummary.reason ?? "", /no provider enrichment jobs/i);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies direct part-linked acquisition jobs stay authoritative even when newer source-derived matches exist.
 */
test("DB-backed detail acquisition summary prefers direct jobs over newer source-derived matches", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);
    await pool.query(`
      INSERT INTO provider_acquisition_jobs VALUES (
        'acqjob-jlcparts-c1091-refresh-failed',
        'jlcparts',
        'C1091',
        'C1091',
        'Guangdong Fenghua Advanced Tech',
        'RC-02W300JT',
        '0402',
        'https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html',
        'exact_provider_part_id',
        1,
        'failed',
        'admin-refresh',
        '2026-04-18T10:00:00.000Z',
        NULL,
        NULL,
        'imported',
        'PROVIDER_IMPORT_FAILED',
        'Refresh failed after the canonical part already existed.',
        '2026-04-18T10:00:03.000Z',
        '2026-04-18T10:00:05.000Z',
        '2026-04-18T10:00:05.000Z'
      )
    `);

    const acquisitionSummary = await readPartAcquisitionSummaryFromDatabase("part-jlcparts-c1091");

    assert.equal(acquisitionSummary.state, "available");
    assert.equal(acquisitionSummary.providerPartKey, "C1091");
    assert.equal(acquisitionSummary.requestedLookup, "RC-02W300JT");
    assert.equal(acquisitionSummary.lastJobStatus, "succeeded");
    assert.equal(acquisitionSummary.completedAt, "2026-04-12T06:57:40.000Z");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies acquisition history can still resolve through attached source rows when no direct acquisition job is recorded.
 */
test("DB-backed detail acquisition summary can resolve through source provider keys only when no direct job exists", async () => {
  const pool = createProviderImportPool({ includeAcquisitionJobs: false });

  try {
    setCatalogStorePoolForTests(pool);
    await pool.query(`
      INSERT INTO provider_acquisition_jobs VALUES (
        'acqjob-jlcparts-c1091-source-fallback',
        'jlcparts',
        'C1091',
        'C1091',
        'Guangdong Fenghua Advanced Tech',
        'RC-02W300JT',
        '0402',
        'https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html',
        'exact_provider_part_id',
        1,
        'failed',
        'admin-refresh',
        '2026-04-18T10:00:00.000Z',
        NULL,
        NULL,
        'imported',
        'PROVIDER_IMPORT_FAILED',
        'Refresh failed after the canonical part already existed.',
        '2026-04-18T10:00:03.000Z',
        '2026-04-18T10:00:05.000Z',
        '2026-04-18T10:00:05.000Z'
      )
    `);

    const acquisitionSummary = await readPartAcquisitionSummaryFromDatabase("part-jlcparts-c1091");

    assert.equal(acquisitionSummary.state, "available");
    assert.equal(acquisitionSummary.providerPartKey, "C1091");
    assert.equal(acquisitionSummary.requestedLookup, "C1091");
    assert.equal(acquisitionSummary.lastJobStatus, "failed");
    assert.equal(acquisitionSummary.completedAt, "2026-04-18T10:00:05.000Z");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies legacy/manual imported parts stay explicit when source evidence exists without acquisition job history.
 */
test("DB-backed detail acquisition summary returns legacy_source_only when source rows exist without acquisition jobs", async () => {
  const pool = createProviderImportPool({ includeAcquisitionJobs: false });

  try {
    setCatalogStorePoolForTests(pool);

    const acquisitionSummary = await readPartAcquisitionSummaryFromDatabase("part-jlcparts-c1091");

    assert.equal(acquisitionSummary.state, "legacy_source_only");
    assert.equal(acquisitionSummary.providerId, "jlcparts");
    assert.equal(acquisitionSummary.providerPartKey, "C1091");
    assert.equal(acquisitionSummary.requestedLookup, null);
    assert.equal(acquisitionSummary.lastJobStatus, null);
    assert.match(acquisitionSummary.reason ?? "", /no acquisition job history/i);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies SQL-backed search applies filters, pagination, stable sorting, and query timings.
 */
test("DB-backed search filters, sorts, and paginates in SQL", async () => {
  const pool = createProviderImportPool();
  const timings: CatalogQueryTiming[] = [];

  try {
    setCatalogStorePoolForTests(pool);
    await seedSearchRows(pool);

    const firstPage = await readPartSearchRecordsFromDatabase({ page: 1, pageSize: 2, sort: "mpn_asc" }, { onQueryTiming: (timing) => timings.push(timing) });
    const secondPage = await readPartSearchRecordsFromDatabase({ page: 2, pageSize: 2, sort: "mpn_asc" });
    const manufacturerFiltered = await readPartSearchRecordsFromDatabase({ manufacturerId: "mfr-search-alpha", sort: "mpn_asc" });
    const lifecycleFiltered = await readPartSearchRecordsFromDatabase({ lifecycleStatus: "obsolete", sort: "mpn_asc" });
    const cadAvailable = await readPartSearchRecordsFromDatabase({ cadAvailability: "available", sort: "mpn_asc" });
    const readinessFiltered = await readPartSearchRecordsFromDatabase({ readinessStatus: "ready_for_export_review", sort: "mpn_asc" });
    const approvalFiltered = await readPartSearchRecordsFromDatabase({ approvalStatus: "approved", sort: "mpn_asc" });
    const connectorFiltered = await readPartSearchRecordsFromDatabase({ connectorClass: "connector", sort: "mpn_asc" });
    const providerPartFiltered = await readPartSearchRecordsFromDatabase({ providerPartId: "C1091", sort: "mpn_asc" });
    const providerUrlFiltered = await readPartSearchRecordsFromDatabase({ providerUrl: "lcsc.com/product-detail/Chip-Resistor", sort: "mpn_asc" });
    const datasheetUrlFiltered = await readPartSearchRecordsFromDatabase({ datasheetUrl: "lcsc_datasheet_2411121005", sort: "mpn_asc" });
    const outOfRangeSingleResultPage = await readPartSearchRecordsFromDatabase({ page: 2, query: "RC-02W300JT", sort: "mpn_asc" });
    const trustSorted = await readPartSearchRecordsFromDatabase({ pageSize: 2, sort: "trust_desc" });

    assert.equal(firstPage.status, "available");
    assert.equal(secondPage.status, "available");
    assert.equal(manufacturerFiltered.status, "available");
    assert.equal(lifecycleFiltered.status, "available");
    assert.equal(cadAvailable.status, "available");
    assert.equal(readinessFiltered.status, "available");
    assert.equal(approvalFiltered.status, "available");
    assert.equal(connectorFiltered.status, "available");
    assert.equal(providerPartFiltered.status, "available");
    assert.equal(providerUrlFiltered.status, "available");
    assert.equal(datasheetUrlFiltered.status, "available");
    assert.equal(trustSorted.status, "available");

    if (
      firstPage.status !== "available" ||
      secondPage.status !== "available" ||
      manufacturerFiltered.status !== "available" ||
      lifecycleFiltered.status !== "available" ||
      cadAvailable.status !== "available" ||
      readinessFiltered.status !== "available" ||
      approvalFiltered.status !== "available" ||
      connectorFiltered.status !== "available" ||
      providerPartFiltered.status !== "available" ||
      providerUrlFiltered.status !== "available" ||
      datasheetUrlFiltered.status !== "available" ||
      outOfRangeSingleResultPage.status !== "available" ||
      trustSorted.status !== "available"
    ) {
      throw new Error("expected DB-backed search records");
    }

    assert.deepEqual(firstPage.records.map((record) => record.part.mpn), ["AAA-100", "BBB-200"]);
    assert.deepEqual(secondPage.records.map((record) => record.part.mpn), ["CCC-300", "RC-02W300JT"]);
    assert.equal(firstPage.pagination.totalRecords, 4);
    assert.equal(firstPage.pagination.totalPages, 2);
    assert.deepEqual(manufacturerFiltered.records.map((record) => record.part.mpn), ["AAA-100", "CCC-300"]);
    assert.deepEqual(lifecycleFiltered.records.map((record) => record.part.mpn), ["BBB-200"]);
    assert.deepEqual(cadAvailable.records.map((record) => record.part.mpn), ["AAA-100"]);
    assert.deepEqual(readinessFiltered.records.map((record) => record.part.mpn), ["AAA-100"]);
    assert.deepEqual(approvalFiltered.records.map((record) => record.part.mpn), ["AAA-100"]);
    assert.deepEqual(connectorFiltered.records.map((record) => record.part.mpn), ["AAA-100", "CCC-300"]);
    assert.deepEqual(providerPartFiltered.records.map((record) => record.part.mpn), ["RC-02W300JT"]);
    assert.deepEqual(providerUrlFiltered.records.map((record) => record.part.mpn), ["RC-02W300JT"]);
    assert.deepEqual(datasheetUrlFiltered.records.map((record) => record.part.mpn), ["RC-02W300JT"]);
    assert.equal(outOfRangeSingleResultPage.pagination.page, 1);
    assert.equal(outOfRangeSingleResultPage.pagination.totalRecords, 1);
    assert.deepEqual(outOfRangeSingleResultPage.records.map((record) => record.part.mpn), ["RC-02W300JT"]);
    assert.deepEqual(trustSorted.records.map((record) => record.part.mpn), ["BBB-200", "CCC-300"]);
    assert.equal(firstPage.records[0]?.metrics.length, 0);
    assert.equal(firstPage.records[0]?.similarParts.length, 0);
    assert.equal(firstPage.records[0]?.assets[0]?.exportStatus, "verified_for_export");
    assert.ok(timings.some((timing) => timing.name === "search_count" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_part_ids" && timing.status === "ok"));
    assert.equal(timings.some((timing) => timing.name === "metrics"), false);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies SQL-backed free-text search handles engineering shorthand that differs from stored metadata.
 */
test("DB-backed search matches compact package names and LDO shorthand", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);
    await seedSearchRows(pool);
    await seedSearchLdoRows(pool);

    const shorthandSearch = await readPartSearchRecordsFromDatabase({ query: "SOT23 LDO" });

    assert.equal(shorthandSearch.status, "available");

    if (shorthandSearch.status !== "available") {
      throw new Error("expected DB-backed shorthand search records");
    }

    assert.deepEqual(shorthandSearch.records.map((record) => record.part.mpn), ["TPS7A02DBVR"]);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies SQL-backed search facets are grouped in-database and stay consistent with active filters.
 */
test("DB-backed search facets are correct, filter-consistent, and timed", async () => {
  const pool = createProviderImportPool();
  const timings: CatalogQueryTiming[] = [];

  try {
    setCatalogStorePoolForTests(pool);
    await seedSearchRows(pool);

    const allFacets = await readPartSearchFacetsFromDatabase({}, { onQueryTiming: (timing) => timings.push(timing) });
    const alphaFacets = await readPartSearchFacetsFromDatabase({ manufacturerId: "mfr-search-alpha" });
    const unavailableCadFacets = await readPartSearchFacetsFromDatabase({ cadAvailability: "unavailable" });

    assert.equal(allFacets.status, "available");
    assert.equal(alphaFacets.status, "available");
    assert.equal(unavailableCadFacets.status, "available");

    if (allFacets.status !== "available" || alphaFacets.status !== "available" || unavailableCadFacets.status !== "available") {
      throw new Error("expected DB-backed facet reads");
    }

    assert.deepEqual(allFacets.facets.manufacturers.map((manufacturer) => manufacturer.id), ["mfr-search-alpha", "mfr-search-beta", "mfr-jlcparts-guangdong-fenghua-advanced-tech"]);
    assert.deepEqual(allFacets.facets.categories, ["Connector", "Power", "Resistors / Chip Resistor - Surface Mount"]);
    assert.equal(allFacets.facets.counts?.manufacturers["mfr-search-alpha"], 2);
    assert.equal(allFacets.facets.counts?.manufacturers["mfr-jlcparts-guangdong-fenghua-advanced-tech"], 1);
    assert.equal(allFacets.facets.counts?.lifecycleStatuses.obsolete, 1);
    assert.equal(allFacets.facets.counts?.cadAvailability.available, 1);
    assert.equal(allFacets.facets.counts?.cadAvailability.unavailable, 3);
    assert.deepEqual(allFacets.facets.readinessStatuses, ["ready_for_export_review", "blocked"]);
    assert.deepEqual(allFacets.facets.approvalStatuses, ["approved", "pending_review", "not_requested"]);
    assert.deepEqual(allFacets.facets.connectorClasses, ["connector", "non_connector"]);
    assert.equal(allFacets.facets.counts?.readinessStatuses.ready_for_export_review, 1);
    assert.equal(allFacets.facets.counts?.readinessStatuses.blocked, 3);
    assert.equal(allFacets.facets.counts?.approvalStatuses.approved, 1);
    assert.equal(allFacets.facets.counts?.approvalStatuses.pending_review, 1);
    assert.equal(allFacets.facets.counts?.approvalStatuses.not_requested, 2);
    assert.equal(allFacets.facets.counts?.connectorClasses.connector, 2);
    assert.equal(allFacets.facets.counts?.connectorClasses.non_connector, 2);

    assert.deepEqual(alphaFacets.facets.manufacturers.map((manufacturer) => manufacturer.id), ["mfr-search-alpha"]);
    assert.deepEqual(alphaFacets.facets.categories, ["Connector"]);
    assert.equal(alphaFacets.facets.counts?.cadAvailability.any, 2);
    assert.equal(alphaFacets.facets.counts?.cadAvailability.available, 1);
    assert.deepEqual(alphaFacets.facets.readinessStatuses, ["ready_for_export_review", "blocked"]);
    assert.deepEqual(alphaFacets.facets.approvalStatuses, ["approved", "pending_review"]);
    assert.deepEqual(alphaFacets.facets.connectorClasses, ["connector"]);

    assert.equal(unavailableCadFacets.facets.counts?.cadAvailability.any, 3);
    assert.equal(unavailableCadFacets.facets.counts?.cadAvailability.available, 0);
    assert.equal(unavailableCadFacets.facets.counts?.cadAvailability.unavailable, 3);
    assert.equal(unavailableCadFacets.facets.packages.some((partPackage) => partPackage.id === "pkg-jlcparts-0402"), true);
    assert.equal(unavailableCadFacets.facets.counts?.readinessStatuses.blocked, 3);
    assert.equal(unavailableCadFacets.facets.counts?.approvalStatuses.not_requested, 2);
    assert.equal(unavailableCadFacets.facets.counts?.approvalStatuses.pending_review, 1);

    assert.ok(timings.some((timing) => timing.name === "search_facet_manufacturers" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_categories" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_packages" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_lifecycle" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_readiness" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_approval" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_connector_class" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_total" && timing.status === "ok"));
    assert.ok(timings.some((timing) => timing.name === "search_facet_cad_available" && timing.status === "ok"));
    assert.equal(timings.some((timing) => timing.name === "search_assets"), false);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies generated draft assets appear in DB-backed detail without enabling export.
 */
test("DB-backed detail exposes generated draft assets as review-required and not exportable", async () => {
  const pool = createProviderImportPool();

  try {
    setCatalogStorePoolForTests(pool);
    await seedGeneratedDraftRows(pool);

    const detailResult = await readPartDetailRecordsFromDatabase("part-jlcparts-c1091");

    assert.equal(detailResult.status, "available");

    if (detailResult.status !== "available") {
      throw new Error("expected DB-backed detail records");
    }

    const detailRecord = detailResult.records.find((record) => record.part.id === "part-jlcparts-c1091");

    assert.ok(detailRecord, "expected imported record in DB-backed detail");

    const detailResponse = buildPartDetailResponse(detailRecord, detailResult.records);
    const symbolGroup = detailResponse.assetGroups.find((group) => group.assetType === "symbol");
    const workflow = detailResponse.generationOptions.find((option) => option.targetAssetType === "symbol")?.workflow;

    assert.equal(symbolGroup?.bestAsset?.provenance, "generated");
    assert.equal(symbolGroup?.bestAsset?.reviewStatus, "review_required");
    assert.equal(symbolGroup?.bestAsset?.exportStatus, "not_exportable");
    assert.equal(workflow?.generationStatus, "review_required");
    assert.equal(workflow?.outputAssetId, "asset-draft-jlcparts-c1091-symbol");
    assert.equal(detailResponse.assetValidationSummaries.find((summary) => summary.assetId === "asset-draft-jlcparts-c1091-symbol")?.latestValidation?.validationType, "symbol_pin_mapping");
    assert.equal(detailResponse.assetPromotionSummaries.find((summary) => summary.assetId === "asset-draft-jlcparts-c1091-symbol")?.latestPromotion?.promotionOutcome, "denied");
    assert.match(detailResponse.assetPromotionSummaries.find((summary) => summary.assetId === "asset-draft-jlcparts-c1091-symbol")?.blockerReasons.join(" ") ?? "", /approved review/u);
    assert.equal(detailResponse.bundleReadiness.exportActions.every((action) => !action.available), true);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies detail reads hydrate relationship targets as summaries instead of full asset/workflow records.
 */
test("DB-backed detail uses lightweight related-part summary reads", async () => {
  const pool = createRelatedSummaryCountingPool();

  try {
    setCatalogStorePoolForTests(pool as unknown as Pool);

    const detailResult = await readPartDetailRecordsFromDatabase("part-main");

    assert.equal(detailResult.status, "available");

    if (detailResult.status !== "available") {
      throw new Error("expected DB-backed detail records");
    }

    assert.deepEqual(detailResult.records.map((record) => record.part.id), ["part-main", "part-mate"]);
    assert.equal(pool.queryTexts.filter((text) => text.includes("FROM assets")).length, 1);
    assert.equal(pool.queryTexts.filter((text) => text.includes("FROM generation_workflows")).length, 1);
    assert.deepEqual(pool.partScopes, [["part-main"], ["part-mate"]]);
  } finally {
    setCatalogStorePoolForTests(null);
  }
});

/**
 * Creates an in-memory Postgres-compatible pool seeded with one imported provider record.
 */
function createProviderImportPool(options: ProviderImportPoolOptions = {}): TestPool {
  const db = newDb();
  const includeAcquisitionJobs = options.includeAcquisitionJobs ?? true;
  const includeEnrichmentJobs = options.includeEnrichmentJobs ?? includeAcquisitionJobs;

  registerPgTrgmShims(db);

  db.public.none(buildMinimalCatalogSchemaSql());
  db.public.none(buildProviderImportRowsSql(includeAcquisitionJobs, includeEnrichmentJobs));

  const { Pool: MemoryPool } = db.adapters.createPg();

  // Catalog reads are tenant-scoped; run the test body as an org-default teammate.
  enterRequestContextForTests("org-default");

  return new MemoryPool() as TestPool;
}

/**
 * Registers deterministic shims for the `pg_trgm` functions used by the search SQL.
 * pg-mem does not implement `pg_trgm`, so without these shims the relevance ORDER BY
 * (`relevanceOrderByClause`) errors at execution time and three DB-backed search tests
 * cannot run. The shim is intentionally simple — exact match → 1, prefix → 0.6, contains
 * → 0.3, otherwise 0 — which is enough to verify the SQL compiles, the relevance branch
 * is invoked, and rows order in a stable, predictable way for fixture-based assertions.
 * Production behavior with real pg_trgm trigram similarity is exercised by manual
 * `npm run migrations` + integration testing, not by this in-memory shim.
 */
function registerPgTrgmShims(db: ReturnType<typeof newDb>): void {
  // Search relevance uses replace() to compact common MPN separators; pg-mem needs a shim.
  db.public.registerFunction({
    name: "replace",
    args: ["text", "text", "text"] as never,
    returns: "text" as never,
    allowNullArguments: true,
    implementation: (value: string | null, searchValue: string | null, replaceValue: string | null): string | null => {
      if (value === null || searchValue === null || replaceValue === null) {
        return null;
      }

      return value.split(searchValue).join(replaceValue);
    }
  });

  db.public.registerFunction({
    name: "similarity",
    args: ["text", "text"] as never,
    returns: "float" as never,
    allowNullArguments: true,
    implementation: (left: string | null, right: string | null): number => {
      if (typeof left !== "string" || typeof right !== "string" || left.length === 0 || right.length === 0) {
        return 0;
      }

      const a = left.toLowerCase();
      const b = right.toLowerCase();

      if (a === b) return 1;
      if (a.startsWith(b) || b.startsWith(a)) return 0.6;
      if (a.includes(b) || b.includes(a)) return 0.3;
      return 0;
    }
  });
}

/**
 * Creates a fake pool that records which scoped queries the detail path executes.
 */
function createRelatedSummaryCountingPool() {
  const queryTexts: string[] = [];
  const partScopes: string[][] = [];

  return {
    partScopes,
    queryTexts,
    async query(text: string, values?: unknown[]) {
      queryTexts.push(text);

      if (text.includes("duplicate_part_id")) {
        return { rows: [] };
      }

      if (text.includes("FROM part_source_reconciliations")) {
        return { rows: [] };
      }

      if (text.includes("FROM parts")) {
        const scope = Array.isArray(values?.[0]) ? (values?.[0] as string[]) : [];

        partScopes.push(scope);

        return {
          rows: scope.map((partId) => (partId === "part-main" ? buildCountingPartRow("part-main", "MAIN-1") : buildCountingPartRow("part-mate", "MATE-1")))
        };
      }

      if (text.includes("FROM mate_relations")) {
        return {
          rows: [
            {
              confidence_score: "0.9",
              id: "mate-main",
              mate_part_id: "part-mate",
              notes: null,
              part_id: "part-main",
              relationship_type: "best_mate",
              source_revision_id: "dsr-main"
            }
          ]
        };
      }

      return { rows: [] };
    }
  };
}

/**
 * Builds one joined part row for the related-summary detail optimization test.
 */
function buildCountingPartRow(partId: string, mpn: string) {
  return {
    body_height_mm: null,
    body_length_mm: null,
    body_width_mm: null,
    category: "Connector",
    connector_family_description: null,
    connector_family_id: null,
    connector_family_name: null,
    connector_family_series: null,
    lifecycle_status: "active",
    manufacturer_aliases: [],
    manufacturer_id: "mfr-counting",
    manufacturer_name: "Counting Manufacturer",
    manufacturer_website: null,
    mpn,
    package_id: "pkg-counting",
    package_name: "Counting Package",
    part_id: partId,
    part_last_updated_at: "2026-04-15T00:00:00.000Z",
    pin_count: 2,
    pitch_mm: null,
    trust_score: "0.7"
  };
}

/**
 * Builds the minimum canonical schema needed by catalog-store's DB-backed read queries.
 */
function buildMinimalCatalogSchemaSql(): string {
  return `
    CREATE TABLE manufacturers (id TEXT, name TEXT, aliases TEXT[], website TEXT);
    CREATE TABLE packages (id TEXT, package_name TEXT, pin_count INTEGER, pitch_mm NUMERIC, body_length_mm NUMERIC, body_width_mm NUMERIC, body_height_mm NUMERIC);
    CREATE TABLE connector_families (id TEXT, name TEXT, series TEXT, description TEXT);
    CREATE TABLE parts (id TEXT, mpn TEXT, description TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, last_updated_at TIMESTAMPTZ, org_id TEXT DEFAULT 'org-default');
    CREATE TABLE source_records (id TEXT, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_extraction_signals (id TEXT, part_id TEXT, source_record_id TEXT, datasheet_revision_id TEXT, asset_id TEXT, signal_type TEXT, extraction_status TEXT, confidence_score NUMERIC, extraction_source TEXT, notes TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE assets (id TEXT, part_id TEXT, asset_type TEXT, file_format TEXT, storage_key TEXT, file_hash TEXT, provider_id TEXT, license_mode TEXT, provenance TEXT, availability_status TEXT, review_status TEXT, export_status TEXT, asset_status TEXT, generation_method TEXT, generation_source_asset_id TEXT, validation_status TEXT, preview_status TEXT, preview_artifact_storage_key TEXT, preview_artifact_format TEXT, preview_artifact_generated_at TIMESTAMPTZ, preview_artifact_source TEXT, asset_state TEXT, source_url TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE datasheet_revisions (id TEXT, part_id TEXT, revision_label TEXT, revision_date DATE, page_count INTEGER, file_asset_id TEXT, parse_confidence NUMERIC, pin_table_status TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_metrics (id TEXT, part_id TEXT, metric_key TEXT, metric_value NUMERIC, unit TEXT, min_value NUMERIC, max_value NUMERIC, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_specifications (id TEXT, part_id TEXT, provider_id TEXT, source_record_id TEXT, spec_key TEXT, spec_value TEXT, spec_group TEXT, last_updated_at TIMESTAMPTZ, org_id TEXT DEFAULT 'org-default');
    CREATE TABLE part_parameters (id TEXT, part_id TEXT, part_type TEXT, param_key TEXT, value_kind TEXT, value_numeric NUMERIC, value_min NUMERIC, value_max NUMERIC, value_text TEXT, unit TEXT, is_conflicted BOOLEAN, confidence_score NUMERIC, winning_provider_id TEXT, winning_source_record_id TEXT, sources JSONB, last_updated_at TIMESTAMPTZ, org_id TEXT DEFAULT 'org-default');
    CREATE TABLE mate_relations (id TEXT, part_id TEXT, mate_part_id TEXT, relationship_type TEXT, compatibility_status TEXT, evidence_kind TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE accessory_requirements (id TEXT, part_id TEXT, accessory_part_id TEXT, relationship_type TEXT, compatibility_status TEXT, evidence_kind TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE cable_compatibilities (id TEXT, part_id TEXT, cable_part_id TEXT, relationship_type TEXT, wire_gauge_min INTEGER, wire_gauge_max INTEGER, shielding_requirement TEXT, termination_style TEXT, compatibility_status TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE connector_family_conflicts (id TEXT, part_id TEXT, candidate_part_id TEXT, candidate_connector_family_id TEXT, conflict_type TEXT, confidence_score NUMERIC, summary TEXT, detail TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE similar_part_relations (id TEXT, part_id TEXT, similar_part_id TEXT, confidence_score NUMERIC, reason TEXT);
    CREATE TABLE companion_recommendations (id TEXT, part_id TEXT, companion_part_id TEXT, confidence_score NUMERIC, usage_context TEXT);
    CREATE TABLE generation_workflows (id TEXT, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, generation_status TEXT, confidence_score NUMERIC, output_asset_id TEXT);
    CREATE TABLE generation_requests (id TEXT, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, request_status TEXT, requested_at TIMESTAMPTZ, requested_by TEXT, workflow_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE review_records (id TEXT, part_id TEXT, target_type TEXT, asset_id TEXT, generation_workflow_id TEXT, outcome TEXT, reviewer TEXT, notes TEXT, reviewed_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_validation_records (id TEXT, part_id TEXT, asset_id TEXT, validation_status TEXT, validation_type TEXT, validation_notes TEXT, validated_at TIMESTAMPTZ, validator TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_promotion_audits (id TEXT, part_id TEXT, asset_id TEXT, prior_export_status TEXT, new_export_status TEXT, promotion_outcome TEXT, blocker_reasons TEXT[], validation_record_id TEXT, actor TEXT, created_at TIMESTAMPTZ);
    CREATE TABLE part_readiness_summaries (part_id TEXT, readiness_status TEXT, identity_status TEXT, connector_class TEXT, blocker_count INTEGER, blocker_summary TEXT[], recommended_actions TEXT[], detail TEXT, last_evaluated_at TIMESTAMPTZ);
    CREATE TABLE part_approvals (part_id TEXT, approval_status TEXT, summary TEXT, detail TEXT, evidence TEXT[], decided_by TEXT, decided_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_issues (id TEXT, part_id TEXT, issue_code TEXT, severity TEXT, status TEXT, assigned_to TEXT, resolution_notes TEXT, resolved_at TIMESTAMPTZ, summary TEXT, detail TEXT, source TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_source_reconciliations (part_id TEXT, preferred_source_record_id TEXT, resolution_status TEXT, notes TEXT, updated_by TEXT, updated_at TIMESTAMPTZ);
    CREATE TABLE part_risk_flags (id TEXT, part_id TEXT, risk_code TEXT, label TEXT, detail TEXT, tone TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE provider_acquisition_jobs (id TEXT, provider_id TEXT, provider_part_key TEXT, requested_lookup TEXT, manufacturer_name TEXT, mpn TEXT, package_name TEXT, source_url TEXT, match_type TEXT, match_confidence NUMERIC, job_status TEXT, requested_by TEXT, requested_at TIMESTAMPTZ, part_id TEXT, import_outcome TEXT, previous_import_status TEXT, error_code TEXT, error_message TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ, org_id TEXT DEFAULT 'org-default');
    CREATE TABLE provider_acquisition_job_events (id TEXT, job_id TEXT, event_type TEXT, message TEXT, detail JSONB, created_at TIMESTAMPTZ);
    CREATE TABLE provider_enrichment_jobs (id TEXT, part_id TEXT, source_acquisition_job_id TEXT, job_type TEXT, job_status TEXT, requested_by TEXT, requested_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, error_code TEXT, error_message TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE provider_enrichment_job_events (id TEXT, job_id TEXT, event_type TEXT, message TEXT, detail JSONB, created_at TIMESTAMPTZ);
  `;
}

/**
 * Builds canonical rows for the real C1091/RC-02W300JT jlcparts import shape.
 */
function buildProviderImportRowsSql(
  includeAcquisitionJobs = true,
  includeEnrichmentJobs = true
): string {
  return `
    INSERT INTO manufacturers VALUES ('mfr-jlcparts-guangdong-fenghua-advanced-tech', 'Guangdong Fenghua Advanced Tech', '{"FH","FH(Guangdong Fenghua Advanced Tech)"}', NULL);
    INSERT INTO packages VALUES ('pkg-jlcparts-0402', '0402', 2, NULL, NULL, NULL, NULL);
    INSERT INTO parts VALUES ('part-jlcparts-c1091', 'RC-02W300JT', 'Resistors 30Ω (0402)', 'mfr-jlcparts-guangdong-fenghua-advanced-tech', 'Resistors / Chip Resistor - Surface Mount', 'active', 'pkg-jlcparts-0402', NULL, 0.62, '2026-04-12T06:57:40.000Z');
    INSERT INTO source_records VALUES ('source-jlcparts-c1091', 'jlcparts', 'C1091', 'part-jlcparts-c1091', 'https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html', '2026-04-12T06:57:40.000Z', '{"component":{"lcsc":"C1091","mfr":"RC-02W300JT"},"indexCreatedAt":"2026-04-12T06:57:40+00:00"}'::jsonb, '2026-04-12T06:57:40.000Z', '2026-04-12T06:57:40.000Z', '2026-04-12T06:57:40.000Z', 'imported', NULL, '2026-04-12T06:57:40.000Z');
    INSERT INTO assets VALUES ('asset-jlcparts-c1091-datasheet', 'part-jlcparts-c1091', 'datasheet', 'pdf', NULL, NULL, 'jlcparts', 'metadata_only', 'trusted_external', 'referenced', 'not_reviewed', 'not_exportable', 'referenced', NULL, NULL, 'not_validated', 'not_available', NULL, NULL, NULL, NULL, 'referenced', 'https://www.lcsc.com/datasheet/lcsc_datasheet_2411121005_FH--Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.pdf', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO datasheet_revisions VALUES ('dsr-jlcparts-c1091', 'part-jlcparts-c1091', 'Provider datasheet reference', NULL, NULL, 'asset-jlcparts-c1091-datasheet', 0, 'not_available', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO source_extraction_signals VALUES ('sig-jlcparts-c1091-package', 'part-jlcparts-c1091', 'source-jlcparts-c1091', 'dsr-jlcparts-c1091', 'asset-jlcparts-c1091-datasheet', 'package_mechanical_dimensions', 'needs_review', 0.35, 'provider_structured_metadata', 'Only provider package code and pin count were mapped; body and pitch dimensions were not extracted.', '2026-04-12T06:57:40.000Z');
    INSERT INTO source_extraction_signals VALUES ('sig-jlcparts-c1091-pin-table', 'part-jlcparts-c1091', 'source-jlcparts-c1091', 'dsr-jlcparts-c1091', 'asset-jlcparts-c1091-datasheet', 'pin_table', 'not_available', 0, 'provider_structured_metadata', 'No reviewed pin table was extracted from the structured provider metadata.', '2026-04-12T06:57:40.000Z');
    INSERT INTO part_metrics VALUES ('metric-jlcparts-c1091-resistance-1', 'part-jlcparts-c1091', 'resistance', 30, 'ohm', NULL, NULL, 0.72, 'dsr-jlcparts-c1091', 'source-jlcparts-c1091', '2026-04-12T06:57:40.000Z');
    INSERT INTO part_specifications VALUES ('spec-jlcparts-c1091-tolerance', 'part-jlcparts-c1091', 'jlcparts', 'source-jlcparts-c1091', 'Tolerance', '±5%', 'parametric', '2026-04-12T06:57:40.000Z', 'org-default');
    INSERT INTO part_specifications VALUES ('spec-jlcparts-c1091-power', 'part-jlcparts-c1091', 'jlcparts', 'source-jlcparts-c1091', 'Power', '1/16W', 'parametric', '2026-04-12T06:57:40.000Z', 'org-default');
    INSERT INTO part_specifications VALUES ('spec-jlcparts-c1091-rohs', 'part-jlcparts-c1091', 'jlcparts', 'source-jlcparts-c1091', 'RoHS Status', 'RoHS Compliant', 'compliance', '2026-04-12T06:57:40.000Z', 'org-default');
    INSERT INTO part_parameters VALUES ('param-part-jlcparts-c1091-resistance', 'part-jlcparts-c1091', 'resistor', 'resistance', 'numeric', 30, NULL, NULL, NULL, 'ohm', FALSE, 0.6, 'jlcparts', 'source-jlcparts-c1091', '[{"providerId":"jlcparts","sourceRecordId":"source-jlcparts-c1091","rawSpecKey":"Resistance","rawValue":"30Ohms","valueNumeric":30,"valueMin":null,"valueMax":null,"valueText":null,"confidence":0.6,"agreesWithWinner":true}]'::jsonb, '2026-04-12T06:57:40.000Z', 'org-default');
    INSERT INTO part_parameters VALUES ('param-part-jlcparts-c1091-package', 'part-jlcparts-c1091', 'resistor', 'package', 'text', NULL, NULL, NULL, '0402', NULL, FALSE, 0.6, 'jlcparts', 'source-jlcparts-c1091', '[]'::jsonb, '2026-04-12T06:57:40.000Z', 'org-default');
    INSERT INTO part_readiness_summaries VALUES ('part-jlcparts-c1091', 'blocked', 'confirmed', 'non_connector', 1, ARRAY['No file-backed CAD evidence is attached for export or downstream design handoff.'], ARRAY['Verify or generate file-backed CAD before export.'], '1 issue remains: No file-backed CAD evidence is attached for export or downstream design handoff.', '2026-04-12T06:57:40.000Z');
    INSERT INTO part_approvals VALUES ('part-jlcparts-c1091', 'not_requested', 'Approval not requested', 'Approval has not been requested yet, so the part should not be treated as engineer-ready.', ARRAY['No approval decision recorded.'], NULL, NULL, '2026-04-12T06:57:40.000Z');
    INSERT INTO part_issues VALUES ('issue-jlcparts-c1091-missing-cad', 'part-jlcparts-c1091', 'missing_verified_cad', 'error', 'open', NULL, NULL, NULL, 'No file-backed CAD evidence is attached for export or downstream design handoff.', 'No file-backed CAD evidence is attached for export or downstream design handoff.', 'asset_truth', '2026-04-12T06:57:40.000Z');
    INSERT INTO part_risk_flags VALUES ('risk-jlcparts-c1091-partial-data', 'part-jlcparts-c1091', 'partial_readiness_data', 'Partial readiness data', 'Readiness evidence is still partial and should be reviewed before relying on this record.', 'review', '2026-04-12T06:57:40.000Z');
    ${includeAcquisitionJobs ? `
    INSERT INTO provider_acquisition_jobs VALUES ('acqjob-jlcparts-c1091', 'jlcparts', 'C1091', 'RC-02W300JT', 'Guangdong Fenghua Advanced Tech', 'RC-02W300JT', '0402', 'https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html', 'exact_mpn', 1, 'succeeded', 'admin-user', '2026-04-12T06:56:40.000Z', 'part-jlcparts-c1091', 'new_import', NULL, NULL, NULL, '2026-04-12T06:56:43.000Z', '2026-04-12T06:57:40.000Z', '2026-04-12T06:57:40.000Z');
    INSERT INTO provider_acquisition_job_events VALUES ('acqevent-jlcparts-c1091-queued', 'acqjob-jlcparts-c1091', 'queued', 'Acquisition job queued.', '{"providerId":"jlcparts"}'::jsonb, '2026-04-12T06:56:40.000Z');
    INSERT INTO provider_acquisition_job_events VALUES ('acqevent-jlcparts-c1091-succeeded', 'acqjob-jlcparts-c1091', 'succeeded', 'Acquisition job succeeded.', '{"partId":"part-jlcparts-c1091"}'::jsonb, '2026-04-12T06:57:40.000Z');
    ` : ""}
    ${includeEnrichmentJobs ? `
    INSERT INTO provider_enrichment_jobs VALUES ('enrichjob-jlcparts-c1091-datasheet', 'part-jlcparts-c1091', 'acqjob-jlcparts-c1091', 'datasheet_capture', 'succeeded', 'admin-user', '2026-04-12T06:57:41.000Z', '2026-04-12T06:57:42.000Z', '2026-04-12T06:57:43.000Z', NULL, NULL, '2026-04-12T06:57:43.000Z');
    INSERT INTO provider_enrichment_job_events VALUES ('enrichevent-jlcparts-c1091-queued', 'enrichjob-jlcparts-c1091-datasheet', 'queued', 'Enrichment job queued.', '{"jobType":"datasheet_capture"}'::jsonb, '2026-04-12T06:57:41.000Z');
    INSERT INTO provider_enrichment_job_events VALUES ('enrichevent-jlcparts-c1091-succeeded', 'enrichjob-jlcparts-c1091-datasheet', 'succeeded', 'Referenced datasheet evidence was captured from provider source data.', '{"jobType":"datasheet_capture"}'::jsonb, '2026-04-12T06:57:43.000Z');
    ` : ""}
  `;
}

/**
 * Seeds deterministic rows that exercise SQL-backed search filters and pagination.
 */
async function seedSearchRows(pool: TestPool): Promise<void> {
  const client = await pool.connect();

  try {
    await insertSearchIdentityRows(client);
    await insertSearchAssetRows(client);
    await insertSearchProjectionRows(client);
  } finally {
    client.release();
  }
}

/**
 * Inserts one package/description mismatch row to exercise human-entered shorthand queries.
 */
async function seedSearchLdoRows(pool: TestPool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      INSERT INTO parts VALUES ('part-search-ldo', 'TPS7A02DBVR', '200 mA low-IQ linear regulator with SOT-23-5 package evidence.', 'mfr-search-alpha', 'Power', 'active', 'pkg-search-sot23', NULL, 0.88, '2026-04-13T00:00:00.000Z');
      INSERT INTO part_readiness_summaries VALUES ('part-search-ldo', 'needs_attention', 'confirmed', 'non_connector', 1, ARRAY['CAD evidence is not verified for export.'], ARRAY['Attach or review CAD assets before export.'], 'CAD evidence is not verified for export.', '2026-04-13T00:00:00.000Z');
      INSERT INTO part_approvals VALUES ('part-search-ldo', 'pending_review', 'Pending engineering approval', 'Review is still active, so the part should not be treated as approved yet.', ARRAY['Approval decision is pending.'], NULL, NULL, '2026-04-13T00:00:00.000Z');
    `);
  } finally {
    client.release();
  }
}

/**
 * Inserts identity rows with deliberate MPN and trust-score ordering ties.
 */
async function insertSearchIdentityRows(client: PoolClient): Promise<void> {
  await client.query(`
    INSERT INTO manufacturers VALUES ('mfr-search-alpha', 'Alpha Components', '{"Alpha"}', NULL);
    INSERT INTO manufacturers VALUES ('mfr-search-beta', 'Beta Components', '{"Beta"}', NULL);
    INSERT INTO packages VALUES ('pkg-search-sot23', 'SOT-23', 3, NULL, NULL, NULL, NULL);
    INSERT INTO packages VALUES ('pkg-search-qfn', 'QFN-16', 16, 0.5, 3, 3, 0.85);
    INSERT INTO parts VALUES ('part-search-a', 'AAA-100', 'Connector AAA-100 (SOT-23)', 'mfr-search-alpha', 'Connector', 'active', 'pkg-search-sot23', NULL, 0.7, '2026-04-10T00:00:00.000Z');
    INSERT INTO parts VALUES ('part-search-b', 'BBB-200', 'Power BBB-200 (QFN-16)', 'mfr-search-beta', 'Power', 'obsolete', 'pkg-search-qfn', NULL, 0.95, '2026-04-11T00:00:00.000Z');
    INSERT INTO parts VALUES ('part-search-c', 'CCC-300', 'Connector CCC-300 (QFN-16)', 'mfr-search-alpha', 'Connector', 'active', 'pkg-search-qfn', NULL, 0.95, '2026-04-12T00:00:00.000Z');
  `);
}

/**
 * Inserts one verified CAD asset and one non-exportable draft to test CAD truth filters.
 */
async function insertSearchAssetRows(client: PoolClient): Promise<void> {
  await client.query(`
    INSERT INTO assets VALUES ('asset-search-a-footprint', 'part-search-a', 'footprint', 'kicad_mod', 'cad/aaa-100.kicad_mod', 'sha256:aaa-footprint', NULL, 'redistribution_allowed', 'manual_internal', 'validated', 'approved', 'verified_for_export', 'verified_for_export', NULL, NULL, 'verified', 'ready', NULL, NULL, NULL, NULL, 'validated', NULL, NULL, '2026-04-12T00:00:00.000Z');
    INSERT INTO assets VALUES ('asset-search-a-symbol', 'part-search-a', 'symbol', 'kicad_sym', 'cad/aaa-100.kicad_sym', 'sha256:aaa-symbol', NULL, 'redistribution_allowed', 'manual_internal', 'validated', 'approved', 'verified_for_export', 'verified_for_export', NULL, NULL, 'verified', 'ready', NULL, NULL, NULL, NULL, 'validated', NULL, NULL, '2026-04-12T00:00:00.000Z');
    INSERT INTO assets VALUES ('asset-search-a-step', 'part-search-a', 'three_d_model', 'step', 'cad/aaa-100.step', 'sha256:aaa-step', NULL, 'redistribution_allowed', 'manual_internal', 'validated', 'approved', 'verified_for_export', 'verified_for_export', NULL, NULL, 'verified', 'ready', NULL, NULL, NULL, NULL, 'validated', NULL, NULL, '2026-04-12T00:00:00.000Z');
    INSERT INTO assets VALUES ('asset-search-c-symbol-draft', 'part-search-c', 'symbol', 'kicad_sym', 'generated/drafts/ccc-300.kicad_sym', 'sha256:ccc-symbol', NULL, 'redistribution_allowed', 'generated', 'downloaded', 'review_required', 'not_exportable', 'downloaded', 'draft_symbol_from_extraction_signal', NULL, 'needs_review', 'pending', NULL, NULL, NULL, NULL, 'downloaded', NULL, NULL, '2026-04-12T00:00:00.000Z');
  `);
}

/**
 * Inserts persisted whole-part readiness projections so SQL-backed filters and facets can exercise the backend contract.
 */
async function insertSearchProjectionRows(client: PoolClient): Promise<void> {
  await client.query(`
    INSERT INTO part_readiness_summaries VALUES ('part-search-a', 'ready_for_export_review', 'confirmed', 'connector', 0, ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'Identity, approval, and export-capable asset evidence are aligned.', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_readiness_summaries VALUES ('part-search-b', 'blocked', 'unknown', 'non_connector', 2, ARRAY['Identity evidence is missing.', 'Lifecycle is obsolete.'], ARRAY['Confirm part identity and provenance before design use.', 'Review lifecycle risk before continuing design use.'], '2 issues remain: Identity evidence is missing. Lifecycle is obsolete.', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_readiness_summaries VALUES ('part-search-c', 'blocked', 'confirmed', 'connector', 2, ARRAY['Connector relationship confidence is below target.', 'Generated CAD still needs review before export.'], ARRAY['Review connector relationship confidence before procurement or layout decisions.', 'Complete review and approval before treating this part as engineer-ready.'], '2 issues remain: Connector relationship confidence is below target. Generated CAD still needs review before export.', '2026-04-12T00:00:00.000Z');

    INSERT INTO part_approvals VALUES ('part-search-a', 'approved', 'Approved for engineering use', 'Whole-part approval is recorded separately from asset review history and export promotion events.', ARRAY['Verified CAD bundle present.', 'Approval decision recorded.'], 'api-test-reviewer', '2026-04-12T00:00:00.000Z', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_approvals VALUES ('part-search-b', 'not_requested', 'Approval not requested', 'Approval has not been requested yet, so the part should not be treated as engineer-ready.', ARRAY['No approval decision recorded.'], NULL, NULL, '2026-04-12T00:00:00.000Z');
    INSERT INTO part_approvals VALUES ('part-search-c', 'pending_review', 'Pending engineering approval', 'Review or generation work is still active, so the part should not be treated as approved yet.', ARRAY['Generated draft asset still needs review.'], NULL, NULL, '2026-04-12T00:00:00.000Z');

    INSERT INTO part_issues VALUES ('issue-search-b-identity', 'part-search-b', 'low_confidence_identity', 'error', 'open', NULL, NULL, NULL, 'Identity evidence is missing.', 'No imported provider source rows are attached, so the record cannot be treated as confirmed.', 'catalog_rule', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_issues VALUES ('issue-search-b-lifecycle', 'part-search-b', 'lifecycle_risk', 'error', 'open', NULL, NULL, NULL, 'Lifecycle is obsolete.', 'Lifecycle status is not active, so this part should be reviewed carefully before design use.', 'catalog_rule', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_issues VALUES ('issue-search-c-confidence', 'part-search-c', 'connector_low_confidence', 'warning', 'open', NULL, NULL, NULL, 'Connector relationship confidence is below target.', 'Buildable set confidence is 72%, so connector compatibility still needs review.', 'connector_intelligence', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_issues VALUES ('issue-search-c-approval', 'part-search-c', 'pending_approval', 'warning', 'open', NULL, NULL, NULL, 'Pending engineering approval', 'Review or generation work is still active, so the part should not be treated as approved yet.', 'approval_state', '2026-04-12T00:00:00.000Z');

    INSERT INTO part_risk_flags VALUES ('risk-search-c-generated', 'part-search-c', 'generated_assets_present', 'Generated CAD present', 'Generated CAD draft remains outside export truth until review and promotion are complete.', 'review', '2026-04-12T00:00:00.000Z');
    INSERT INTO part_risk_flags VALUES ('risk-search-b-lifecycle', 'part-search-b', 'lifecycle_not_active', 'Lifecycle not active', 'Lifecycle is not active, so downstream use needs extra review.', 'danger', '2026-04-12T00:00:00.000Z');
  `);
}

/**
 * Seeds a generated symbol draft that mimics the worker Phase 5B output truth fields.
 */
async function seedGeneratedDraftRows(pool: TestPool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(
      `
        INSERT INTO assets VALUES (
          'asset-draft-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'symbol',
          'kicad_sym',
          'generated/drafts/part-jlcparts-c1091/symbol.kicad_sym',
          'sha256:generated-draft',
          NULL,
          'redistribution_allowed',
          'generated',
          'downloaded',
          'review_required',
          'not_exportable',
          'downloaded',
          'draft_symbol_from_extraction_signal',
          'asset-jlcparts-c1091-datasheet',
          'needs_review',
          'pending',
          NULL,
          NULL,
          NULL,
          NULL,
          'downloaded',
          NULL,
          'source-jlcparts-c1091',
          '2026-04-15T00:00:00.000Z'
        )
      `
    );
    await client.query(
      `
        INSERT INTO generation_workflows VALUES (
          'gen-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'symbol',
          'dsr-jlcparts-c1091',
          'asset-jlcparts-c1091-datasheet',
          'review_required',
          0.72,
          'asset-draft-jlcparts-c1091-symbol'
        )
      `
    );
    await client.query(
      `
        INSERT INTO generation_requests VALUES (
          'request-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'symbol',
          'dsr-jlcparts-c1091',
          'asset-jlcparts-c1091-datasheet',
          'review_required',
          '2026-04-15T00:00:00.000Z',
          'local-dev',
          'gen-jlcparts-c1091-symbol',
          '2026-04-15T00:00:00.000Z'
        )
      `
    );
    await client.query(
      `
        INSERT INTO asset_validation_records VALUES (
          'validation-draft-jlcparts-c1091-symbol',
          'part-jlcparts-c1091',
          'asset-draft-jlcparts-c1091-symbol',
          'verified',
          'symbol_pin_mapping',
          'Draft symbol pin mapping was checked against extracted provider evidence.',
          '2026-04-15T00:10:00.000Z',
          'api-test-validator',
          '2026-04-15T00:10:00.000Z'
        )
      `
    );
    await client.query(
      `
        INSERT INTO asset_promotion_audits VALUES (
          'promotion-draft-jlcparts-c1091-symbol-denied',
          'part-jlcparts-c1091',
          'asset-draft-jlcparts-c1091-symbol',
          'not_exportable',
          'not_exportable',
          'denied',
          '{"Promotion requires an explicit approved review state."}',
          NULL,
          'api-test-promoter',
          '2026-04-15T00:11:00.000Z'
        )
      `
    );
  } finally {
    client.release();
  }
}
