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
import type { Asset, DocumentRevisionListResponse, PartSupplyOffersResponse, PartWhereUsedResponse } from "@ee-library/shared/types";

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

    assert.match(html, /Where this part stands/u);
    assert.match(html, /Use decision/u);
    assert.match(html, /Do not use yet/u);
    assert.match(html, /CAD\/export/u);
    assert.match(html, /Source/u);
    assert.match(html, /Next action/u);
    assert.match(html, /Resolve CAD\/export assets/u);
    assert.match(html, /Blocked/u);
    assert.match(html, /Export readiness/u);
    assert.match(html, /Alternates and companions/u);
    assert.match(html, /Sourcing and lifecycle/u);
    assert.match(html, /Distributor offers/u);
    assert.match(html, /No distributor offers recorded/u);
    assert.match(html, /What is blocking this part/u);
    assert.match(html, /Risk flags/u);
    assert.match(html, /Review and export status/u);
    assert.match(html, /Where-used/u);
    assert.match(html, /Document control/u);
    assert.match(html, /Next workspaces/u);
    assert.match(html, /Compare this part/u);
    assert.match(html, /Check where-used/u);
    assert.match(html, /Attach evidence/u);
    assert.match(html, /See what is blocking export/u);
    assert.match(html, /No confirmed project usage/u);
    assert.match(html, /No controlled revisions/u);
    assert.match(html, /draft CAD needs review/u);
    assert.match(html, /Approving the part does not review its files or mark them ready for export/u);
    assert.match(html, /Files and models/u);
    assert.match(html, /File status/u);
    assert.match(html, /Review step/u);
    assert.match(html, /Trust check/u);
    assert.match(html, /Ready for project export/u);
    assert.doesNotMatch(html, /<button class="export-action export-action--available"/u);
    assert.match(html, /Not ready yet/u);
    assert.doesNotMatch(html, /approved part/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the decision-point push: confirmed "this bit us" memory interrupts at the top of the
 * part-detail hero as a warning (not a gate) before the use decision.
 */
test("part detail surfaces a prior engineering-memory warning banner near the use decision", async () => {
  const records = getAllPartRecords();
  const baseRecord = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(baseRecord, "expected seed part detail record");

  const record = {
    ...baseRecord,
    engineeringMemoryWarning: {
      blockingCount: 0,
      preview: [
        { outcome: "bit_us" as const, recordId: "perec-1", recordKind: "outcome" as const, severity: "caution" as const, title: "Bit us: contact retention failure on Bravo" }
      ],
      warningCount: 1
    }
  };

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /This part bit your team before/u);
    assert.match(html, /contact retention failure on Bravo/u);
    assert.match(html, /reuse warning, not a gate/u);
    assert.match(html, /Review the full engineering memory/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the top files panel does not label reference-only URLs as downloads
 * and does not duplicate the datasheet row.
 */
test("part detail files panel separates stored downloads from source references", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-te-215079-8");

  assert.ok(record, "expected connector seed part detail record");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));
    const filesPanelHtml = extractPanelHtml(html, "Files and downloads");

    assert.match(filesPanelHtml, /Download file/u);
    assert.match(filesPanelHtml, /View source/u);
    assert.doesNotMatch(filesPanelHtml, />Download</u);
    assert.equal(countPanelLabel(filesPanelHtml, "Datasheet"), 1);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies seed fallback pages do not offer database-backed storage downloads that
 * cannot work without the real catalog store.
 */
test("part detail files panel disables sample storage downloads in seed fallback", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-te-215079-8");

  assert.ok(record, "expected connector seed part detail record");

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records),
      source: "seed_fallback"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));
    const filesPanelHtml = extractPanelHtml(html, "Files and downloads");

    assert.match(filesPanelHtml, /Sample file not available/u);
    assert.match(filesPanelHtml, /View source/u);
    assert.doesNotMatch(filesPanelHtml, /Download file/u);
    assert.doesNotMatch(html, /class="asset-download-link"[^>]*>Download file</u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies controlled document gates are reflected in the top files panel, not only
 * in the lower asset cards.
 */
test("part detail files panel requires acknowledgement for restricted controlled documents", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-te-215079-8");

  assert.ok(record, "expected connector seed part detail record");

  const detail = buildPartDetailResponse(record, records);
  const gatedAsset = detail.assetGroups.find((group) => group.bestAsset !== null && group.bestAsset.storageKey !== null && group.bestAsset.fileHash !== null)?.bestAsset;

  assert.ok(gatedAsset, "expected file-backed asset for controlled document test");

  const restoreFetch = mockFetch(
    () =>
      jsonResponse({
        data: detail,
        source: "database"
      }),
    undefined,
    undefined,
    () =>
      jsonResponse({
        data: buildRestrictedDocumentControlResponse(record.part.id, gatedAsset),
        source: "database"
      })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));
    const filesPanelHtml = extractPanelHtml(html, "Files and downloads");
    const gatedDownloadPath = `/assets/${encodeURIComponent(gatedAsset.id)}/download`;

    assert.match(filesPanelHtml, /Acknowledge and download/u);
    assert.ok(filesPanelHtml.includes(`${gatedDownloadPath}?ack=1`), "expected gated top-panel download to include acknowledgement");
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies failed stored assets remain visible as failed records without a download
 * affordance that the API will reject.
 */
test("part detail does not offer downloads for failed file-backed assets", async () => {
  const records = getAllPartRecords();
  const baseRecord = records.find((candidate) => candidate.part.id === "part-te-215079-8");

  assert.ok(baseRecord, "expected connector seed part detail record");

  const record = structuredClone(baseRecord);
  const failedAsset = record.assets.find((asset) => asset.storageKey !== null && asset.fileHash !== null);

  assert.ok(failedAsset, "expected file-backed asset for failed asset test");

  for (const asset of record.assets) {
    if (asset.assetType !== failedAsset.assetType) continue;

    asset.availabilityStatus = "failed";
    asset.assetState = "failed";
    asset.assetStatus = "failed";
    asset.exportStatus = "not_exportable";
    asset.validationStatus = "failed";
  }

  const restoreFetch = mockFetch(() =>
    jsonResponse({
      data: buildPartDetailResponse(record, records),
      source: "database"
    })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));
    const filesPanelHtml = extractPanelHtml(html, "Files and downloads");
    const failedDownloadPattern = new RegExp(`/assets/${escapeRegExp(encodeURIComponent(failedAsset.id))}/download`, "u");

    assert.match(filesPanelHtml, /File failed/u);
    assert.doesNotMatch(html, failedDownloadPattern);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies catalog setup failures render guidance instead of route-fatal detail errors.
 */
test("part detail renders setup guidance when catalog detail is unavailable", async () => {
  const restoreFetch = mockFetch(() =>
    jsonResponse(
      {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Catalog database is not configured."
        }
      },
      503
    )
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: "part-tps7a02dbvr" }) }));

    assert.match(html, /catalog database is not connected yet/u);
    assert.match(html, /What you can do now/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.match(html, /Project usage history/u);
    assert.doesNotMatch(html, /No matching parts found/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies confirmed where-used records render project context without changing approval/export truth.
 */
test("part detail renders confirmed where-used project usage", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seed part detail record");

  const restoreFetch = mockFetch(
    () =>
      jsonResponse({
        data: buildPartDetailResponse(record, records),
        source: "database"
      }),
    () =>
      jsonResponse({
        data: buildWhereUsedResponse(record.part.id),
        source: "database"
      })
  );

  try {
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ partId: record.part.id }) }));

    assert.match(html, /Where-used/u);
    assert.match(html, /Alpha Controller/u);
    assert.match(html, /Rev A/u);
    assert.match(html, /U1/u);
    assert.match(html, />1</u);
    assert.match(html, /Main rail regulator/u);
    assert.match(html, /Showing this part in projects or circuit blocks does not approve it or make it ready to export/u);
    assert.match(html, /Circuit blocks/u);
    assert.match(html, /Alpha power rail/u);
    assert.match(html, /ALPHA-POWER/u);
    assert.match(html, /Ready to reuse/u);
    assert.match(html, /Main LDO/u);
    assert.match(html, /Approving the part does not review its files or mark them ready for export/u);
    assert.match(html, /Ready for project export|Not ready/u);
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
    assert.match(html, /Best mate/u);
    assert.match(html, /Required accessories/u);
    assert.match(html, /Mates and accessories you need to build with this connector/u);
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
    assert.match(html, /Update running/u);
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
    assert.match(html, /Updates unavailable/u);
    assert.match(html, /seed fallback data/u);
    assert.doesNotMatch(html, /Imported via acquisition job/u);
  } finally {
    restoreSeedFetch();
  }
});

/**
 * Replaces global fetch for detail, where-used, document-control, and supply-offer API calls.
 */
function mockFetch(
  handler: (url: URL) => Response,
  whereUsedHandler?: (url: URL) => Response,
  supplyOffersHandler?: (url: URL) => Response,
  documentControlHandler?: (url: URL) => Response
): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    if (isWhereUsedRequest(url)) {
      return whereUsedHandler ? whereUsedHandler(url) : jsonResponse({
        data: buildEmptyWhereUsedResponse(readWhereUsedPartId(url)),
        source: "database"
      });
    }

    if (isDocumentControlRequest(url)) {
      return documentControlHandler ? documentControlHandler(url) : jsonResponse({
        data: buildEmptyDocumentControlResponse(readDocumentControlPartId(url)),
        source: "database"
      });
    }

    if (isSupplyOffersRequest(url)) {
      return supplyOffersHandler ? supplyOffersHandler(url) : jsonResponse({
        data: buildEmptySupplyOffersResponse(readSupplyOffersPartId(url)),
        source: "database"
      });
    }

    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Detects the part-scoped where-used API request added beside detail reads.
 */
function isWhereUsedRequest(url: URL): boolean {
  return /^\/parts\/[^/]+\/usages$/u.test(url.pathname);
}

/**
 * Detects the part-scoped document-control API request added beside detail reads.
 */
function isDocumentControlRequest(url: URL): boolean {
  return /^\/parts\/[^/]+\/document-revisions$/u.test(url.pathname);
}

/**
 * Detects the part-scoped supply-offer API request added beside detail reads.
 */
function isSupplyOffersRequest(url: URL): boolean {
  return /^\/parts\/[^/]+\/supply-offers$/u.test(url.pathname);
}

/**
 * Reads the part id from the where-used URL for default empty where-used fixtures.
 */
function readWhereUsedPartId(url: URL): string {
  const match = /^\/parts\/([^/]+)\/usages$/u.exec(url.pathname);

  return match?.[1] ? decodeURIComponent(match[1]) : "part-unknown";
}

/**
 * Reads the part id from the document-control URL for default empty fixtures.
 */
function readDocumentControlPartId(url: URL): string {
  const match = /^\/parts\/([^/]+)\/document-revisions$/u.exec(url.pathname);

  return match?.[1] ? decodeURIComponent(match[1]) : "part-unknown";
}

/**
 * Reads the part id from the supply-offer URL for default empty fixtures.
 */
function readSupplyOffersPartId(url: URL): string {
  const match = /^\/parts\/([^/]+)\/supply-offers$/u.exec(url.pathname);

  return match?.[1] ? decodeURIComponent(match[1]) : "part-unknown";
}

/**
 * Builds the default empty where-used response for tests that only care about detail payloads.
 */
function buildEmptyWhereUsedResponse(partId: string): PartWhereUsedResponse {
  return {
    circuitBlockDependencies: [],
    partId,
    state: "empty",
    usages: []
  };
}

/**
 * Builds the default empty document-control response for tests that only care about detail payloads.
 */
function buildEmptyDocumentControlResponse(partId: string): DocumentRevisionListResponse {
  return {
    boundary: "Document control test boundary.",
    partId,
    revisions: [],
    state: "empty"
  };
}

/**
 * Builds one active restricted revision attached to an asset for download-gate tests.
 */
function buildRestrictedDocumentControlResponse(partId: string, asset: Asset): DocumentRevisionListResponse {
  const now = "2026-05-01T12:00:00.000Z";

  return {
    boundary: "Document control test boundary.",
    partId,
    revisions: [
      {
        accessLevel: "restricted",
        accessNotes: "Restricted drawing package.",
        aclEntries: [],
        asset: {
          availabilityStatus: asset.availabilityStatus,
          assetType: asset.assetType,
          fileFormat: asset.fileFormat,
          fileHash: asset.fileHash,
          id: asset.id,
          partId: asset.partId,
          provenance: asset.provenance,
          sourceUrl: asset.sourceUrl,
          storageKey: asset.storageKey
        },
        assetId: asset.id,
        createdAt: now,
        createdBy: "test",
        documentType: "datasheet",
        effectiveAt: null,
        expiresAt: null,
        id: `docrev-${asset.id}`,
        lifecycleStatus: "released",
        partId,
        redlines: [],
        revisionDate: "2026-05-01",
        revisionLabel: "A",
        sourceAssetHash: asset.fileHash,
        supersededByDocumentRevisionId: null,
        supersedesDocumentRevisionId: null,
        updatedAt: now
      }
    ],
    state: "available"
  };
}

/**
 * Escapes a dynamic URL segment for regex-based rendered-markup assertions.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Builds the default empty supply-offer response for tests that only care about detail payloads.
 */
function buildEmptySupplyOffersResponse(partId: string): PartSupplyOffersResponse {
  return {
    boundary: "Supply offers test boundary.",
    offers: [],
    partId,
    staleAfterDays: 14,
    state: "empty",
    summary: {
      inStockOfferCount: 0,
      lastSeenAt: null,
      lowestUnitPrice: null,
      offerCount: 0,
      staleOfferCount: 0
    }
  };
}

/**
 * Extracts one SectionPanel by its heading so tests can make scoped assertions.
 */
function extractPanelHtml(html: string, title: string): string {
  const heading = `<h2>${title}</h2>`;
  const start = html.indexOf(heading);
  assert.notEqual(start, -1, `expected panel heading ${title}`);
  const end = html.indexOf("</section>", start);
  assert.notEqual(end, -1, `expected panel closing tag after ${title}`);
  return html.slice(start, end);
}

/**
 * Counts the strong row labels inside a scoped panel without matching later sections.
 */
function countPanelLabel(panelHtml: string, label: string): number {
  return panelHtml.split(`<strong>${label}</strong>`).length - 1;
}

/**
 * Builds a confirmed where-used fixture with project, revision, designator, and quantity context.
 */
function buildWhereUsedResponse(partId: string): PartWhereUsedResponse {
  return {
    circuitBlockDependencies: [
      {
        blockParts: [
          {
            circuitBlockId: "cblock-alpha-power",
            createdAt: "2026-05-01T12:10:00.000Z",
            id: "cbpart-alpha-power-ldo",
            isRequired: true,
            notes: "Reuse with reviewed output capacitor.",
            partId,
            quantity: 1,
            role: "Main LDO",
            substitutionPolicy: "exact_required",
            updatedAt: "2026-05-01T12:10:00.000Z"
          }
        ],
        summary: {
          approvedPartCount: 1,
          circuitBlock: {
            blockKey: "ALPHA-POWER",
            blockType: "power",
            constraints: {},
            createdAt: "2026-05-01T12:00:00.000Z",
            description: "Reusable LDO rail.",
            id: "cblock-alpha-power",
            name: "Alpha power rail",
            owner: "Hardware",
            reuseScope: "Memory test rails",
            status: "approved",
            updatedAt: "2026-05-01T13:00:00.000Z"
          },
          activeBlockingRiskCount: 0,
          activeKnownRiskCount: 0,
          evidenceAttachmentCount: 0,
          lifecycleRiskCount: 0,
          optionalPartCount: 0,
          projectUsageCount: 1,
          readinessGapCount: 0,
          requiredPartCount: 1,
          strictSubstitutionCount: 1,
          totalPartCount: 1
        }
      }
    ],
    partId,
    state: "available",
    usages: [
      {
        bomLine: {
          bomImportId: "bom-alpha-a",
          createdAt: "2026-04-30T00:04:00.000Z",
          designators: ["U1"],
          id: "line-alpha-1",
          instantiatedAt: null,
          instantiatedFromCircuitBlockId: null,
          instantiatedFromCircuitBlockPartId: null,
          matchConfidenceScore: 1,
          matchedPartId: partId,
          matchStatus: "matched",
          projectId: "project-alpha",
          projectRevisionId: "rev-alpha-a",
          quantity: 1,
          rawDescription: "LDO regulator",
          rawManufacturer: "Texas Instruments",
          rawMpn: "TPS7A02DBVR",
          rawNotes: null,
          rawRowPayload: { row: 1 },
          rawSupplierReference: null,
          rowNumber: 1,
          updatedAt: "2026-04-30T00:04:00.000Z"
        },
        project: {
          createdAt: "2026-04-30T00:00:00.000Z",
          description: "Memory API test project",
          id: "project-alpha",
          name: "Alpha Controller",
          owner: "hardware",
          projectKey: "ALPHA",
          status: "active",
          updatedAt: "2026-04-30T00:01:00.000Z"
        },
        projectRevision: {
          createdAt: "2026-04-30T00:02:00.000Z",
          id: "rev-alpha-a",
          projectId: "project-alpha",
          releasedAt: null,
          revisionLabel: "A",
          revisionStatus: "draft",
          sourceReference: "alpha-a",
          updatedAt: "2026-04-30T00:02:00.000Z"
        },
        usage: {
          approvalSnapshot: { approvalStatus: "not_requested" },
          bomLineId: "line-alpha-1",
          createdAt: "2026-04-30T00:06:00.000Z",
          designators: ["U1"],
          id: "usage-alpha-u1",
          partId,
          projectId: "project-alpha",
          projectRevisionId: "rev-alpha-a",
          quantity: 1,
          readinessSnapshot: { readinessStatus: "blocked" },
          updatedAt: "2026-04-30T00:06:00.000Z",
          usageContext: "Main rail regulator",
          usageStatus: "used"
        }
      }
    ]
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
