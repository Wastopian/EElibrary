/**
 * File header: Tests the part detail readiness record rendering against backend-shaped data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPartRecords } from "@ee-library/shared/search";
import {
  buildPartDetailResponse,
  buildUnavailablePartAcquisitionSummary,
  buildUnavailablePartEnrichmentSummary
} from "../../../../../api/src/detail-response";
import PartDetailPage from "./page";

/**
 * Verifies the detail page renders V3-style readiness record truth without whole-part approval claims.
 */
test("part detail renders readiness record summary from detail response", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seed part detail record");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Readiness record/u);
    assert.match(html, /Use decision/u);
    assert.match(html, /Do not use yet/u);
    assert.match(html, /CAD\/export/u);
    assert.match(html, /Provenance/u);
    assert.match(html, /Next action/u);
    assert.match(html, /Resolve CAD\/export assets/u);
    assert.match(html, /Blocked/u);
    assert.match(html, /Source rows/u);
    assert.match(html, /Asset rows/u);
    assert.match(html, /Bundle gate/u);
    assert.match(html, /Alternates and companions/u);
    assert.match(html, /Sourcing and lifecycle/u);
    assert.match(html, /Distributor pricing/u);
    assert.match(html, /not in the current API contract/u);
    assert.match(html, /Top blockers/u);
    assert.match(html, /Risk flags/u);
    assert.match(html, /Review and export state/u);
    assert.match(html, /draft CAD needs review/u);
    assert.match(html, /Whole-part approval remains separate from generated asset review and explicit export promotion/u);
    assert.match(html, /Files and models/u);
    assert.match(html, /Class state/u);
    assert.match(html, /Review lane/u);
    assert.match(html, /Ready bundles/u);
    assert.match(html, /Blocked bundles/u);
    assert.match(html, /Export lane/u);
    assert.doesNotMatch(html, /approved part/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies connector detail pages elevate the buildable mate and accessory set near readiness.
 */
test("connector detail elevates connector build set near the top of the readiness record", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.mpn === "215079-8");

  assert.ok(record, "expected connector seed part detail record");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Connector build set/u);
    assert.match(html, /Mates and accessories/u);
    assert.match(html, /Mapped/u);
    assert.match(html, /Best mate/u);
    assert.match(html, /Required accessories/u);
    assert.match(html, /Implementation-friendly mate and accessory context/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies imported parts show acquisition provenance and the explicit imported-does-not-mean boundary copy.
 */
test("part detail renders acquisition summary fields and imported boundary copy", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seeded regulator part");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records, {
        completedAt: "2026-04-18T10:03:00.000Z",
        lastJobStatus: "succeeded",
        manufacturerName: "Texas Instruments",
        mpn: "TPS7A02DBVR",
        providerId: "jlcparts",
        providerPartKey: "C2841794",
        reason: null,
        requestedAt: "2026-04-18T10:00:00.000Z",
        requestedBy: null,
        requestedLookup: "TPS7A02DBVR",
        sourceUrl: "https://lcsc.com/product-detail/example",
        state: "available"
      }),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Acquisition summary/u);
    assert.match(html, /Imported via acquisition job/u);
    assert.match(html, /C2841794/u);
    assert.match(html, /TPS7A02DBVR/u);
    assert.match(html, /Imported does not mean approved, export-ready, or CAD-verified/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies legacy source-only provenance stays explicit without pretending a recorded acquisition job exists.
 */
test("part detail renders legacy source-only acquisition state explicitly", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seeded regulator part");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records, {
        completedAt: null,
        lastJobStatus: null,
        manufacturerName: null,
        mpn: null,
        providerId: "jlcparts",
        providerPartKey: "C2841794",
        reason: "This part has attached provider source evidence, but no acquisition job history was recorded for it.",
        requestedAt: null,
        requestedBy: null,
        requestedLookup: null,
        sourceUrl: "https://lcsc.com/product-detail/example",
        state: "legacy_source_only"
      }),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Legacy source evidence only/u);
    assert.match(html, /no acquisition job history was recorded for it/u);
    assert.match(html, /Imported does not mean approved, export-ready, or CAD-verified/u);
    assert.doesNotMatch(html, /Imported via acquisition job/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the completeness checklist can show a realistic mix of available, review, blocked, and missing states.
 */
test("part detail renders the completeness checklist with realistic mixed states", async () => {
  const records = getAllPartRecords();
  const baseRecord = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(baseRecord, "expected seeded regulator part");

  const record = structuredClone(baseRecord);
  record.datasheetRevision = null;
  record.approval = {
    ...record.approval,
    detail: "Approval has not been requested yet, so the part should not be treated as engineer-ready.",
    status: "not_requested",
    summary: "Approval not requested"
  };

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records, {
        completedAt: null,
        lastJobStatus: null,
        manufacturerName: null,
        mpn: null,
        providerId: null,
        providerPartKey: null,
        reason: "No provider acquisition job or attached provider source evidence is recorded for this part yet.",
        requestedAt: null,
        requestedBy: null,
        requestedLookup: null,
        sourceUrl: null,
        state: "not_recorded"
      }),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Completeness checklist/u);
    assert.match(html, /Identity confidence/u);
    assert.match(html, /Datasheet availability/u);
    assert.match(html, /Symbol availability/u);
    assert.match(html, /Approval\/review state/u);
    assert.match(html, /Available/u);
    assert.match(html, /Missing/u);
    assert.match(html, /Not approved/u);
    assert.match(html, /Requestable|Needs review|Draft in review/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the enrichment card renders queued, running, succeeded, and failed job states without changing checklist truth.
 */
test("part detail renders enrichment states while the completeness checklist stays tied to stored truth", async () => {
  const records = getAllPartRecords();
  const baseRecord = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(baseRecord, "expected seeded regulator part");

  const record = structuredClone(baseRecord);
  record.datasheetRevision = null;
  record.assets = record.assets.filter((asset) => asset.assetType !== "datasheet");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(
        record,
        records,
        {
          completedAt: null,
          lastJobStatus: null,
          manufacturerName: null,
          mpn: null,
          providerId: null,
          providerPartKey: null,
          reason: "No provider acquisition job or attached provider source evidence is recorded for this part yet.",
          requestedAt: null,
          requestedBy: null,
          requestedLookup: null,
          sourceUrl: null,
          state: "not_recorded"
        },
        {
          activeJobCount: 2,
          jobs: [
            {
              completedAt: null,
              errorCode: null,
              errorMessage: null,
              id: "enrichjob-queued",
              jobStatus: "queued",
              jobType: "datasheet_capture",
              lastUpdatedAt: "2026-04-24T12:00:00.000Z",
              requestedAt: "2026-04-24T12:00:00.000Z",
              startedAt: null
            },
            {
              completedAt: null,
              errorCode: null,
              errorMessage: null,
              id: "enrichjob-running",
              jobStatus: "running",
              jobType: "datasheet_capture",
              lastUpdatedAt: "2026-04-24T12:01:00.000Z",
              requestedAt: "2026-04-24T12:00:30.000Z",
              startedAt: "2026-04-24T12:01:00.000Z"
            },
            {
              completedAt: "2026-04-24T11:59:00.000Z",
              errorCode: null,
              errorMessage: null,
              id: "enrichjob-succeeded",
              jobStatus: "succeeded",
              jobType: "datasheet_capture",
              lastUpdatedAt: "2026-04-24T11:59:00.000Z",
              requestedAt: "2026-04-24T11:58:00.000Z",
              startedAt: "2026-04-24T11:58:10.000Z"
            },
            {
              completedAt: "2026-04-24T11:57:00.000Z",
              errorCode: "NO_DATASHEET_SOURCE",
              errorMessage: "No official provider datasheet source is recorded for this part yet.",
              id: "enrichjob-failed",
              jobStatus: "failed",
              jobType: "datasheet_capture",
              lastUpdatedAt: "2026-04-24T11:57:00.000Z",
              requestedAt: "2026-04-24T11:56:00.000Z",
              startedAt: "2026-04-24T11:56:10.000Z"
            }
          ],
          latestJobStatus: "running",
          reason: null,
          state: "available"
        }
      ),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Enrichment status/u);
    assert.match(html, /Enrichment running/u);
    assert.match(html, /Datasheet capture/u);
    assert.match(html, /Queued/u);
    assert.match(html, /Running/u);
    assert.match(html, /Succeeded/u);
    assert.match(html, /Failed/u);
    assert.match(html, /Enriched does not mean approved/u);
    assert.match(html, /Datasheet availability/u);
    assert.match(html, /Missing/u);
    assert.match(html, /No official provider datasheet source is recorded for this part yet/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies no-job and seed-fallback detail states stay explicit instead of inventing acquisition history.
 */
test("part detail keeps no-history and seed-fallback acquisition states explicit", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seeded regulator part");

  const restoreNoHistoryFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records, {
        completedAt: null,
        lastJobStatus: null,
        manufacturerName: null,
        mpn: null,
        providerId: null,
        providerPartKey: null,
        reason: "No provider acquisition job or attached provider source evidence is recorded for this part yet.",
        requestedAt: null,
        requestedBy: null,
        requestedLookup: null,
        sourceUrl: null,
        state: "not_recorded"
      }),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /No acquisition history recorded/u);
    assert.match(html, /No provider acquisition job or attached provider source evidence is recorded for this part yet/u);
    assert.doesNotMatch(html, /Imported via acquisition job/u);
  } finally {
    restoreNoHistoryFetch();
  }

  const restoreSeedFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(
        record,
        records,
        buildUnavailablePartAcquisitionSummary("Acquisition history is unavailable while this part detail is being served from seed fallback data.")
        ,
        buildUnavailablePartEnrichmentSummary("Enrichment history is unavailable while this part detail is being served from seed fallback data.")
      ),
      source: "seed_fallback"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Acquisition history unavailable/u);
    assert.match(html, /Enrichment unavailable/u);
    assert.match(html, /seed fallback data/u);
    assert.doesNotMatch(html, /Imported via acquisition job/u);
  } finally {
    restoreSeedFetch();
  }
});

/**
 * Replaces global fetch for the detail API call and returns a restore callback.
 */
function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Builds a JSON Response with stable headers for the API client.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}
