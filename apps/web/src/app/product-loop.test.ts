/**
 * File header: Protects the core search -> import -> detail product loop with local fixture data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { getAllPartRecords } from "@ee-library/shared/search";
import { buildPartDetailResponse } from "../../../api/src/detail-response";
import { requestProviderImport } from "../lib/api-client";
import SearchPage from "./catalog/page";
import PartDetailPage from "./parts/[partId]/page";
import type { ProviderImportCreateInput, SearchPagination } from "@ee-library/shared/types";

/**
 * Verifies the first product loop stays practical: search, import one exact local fixture, open detail.
 */
test("happy path product loop imports a local fixture and opens answer-first detail", async () => {
  const records = getAllPartRecords();
  const target = records.find((record) => record.part.id === "part-tps7a02dbvr");
  let importBody: ProviderImportCreateInput | null = null;

  assert.ok(target, "expected TPS7A02DBVR local fixture record");

  const restoreFetch = mockFetch((input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    if (url.pathname === "/api/token") {
      return jsonResponse({ token: "product-loop-test-token" });
    }

    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse());
    }

    if (url.pathname.startsWith("/parts/facets")) {
      return jsonResponse({ data: getSearchFacetsFromRecords(records), source: "database" });
    }

    if (url.pathname === "/parts") {
      return jsonResponse({ data: [], pagination: buildPagination(0), source: "database" });
    }

    if (url.pathname === "/imports/provider") {
      importBody = JSON.parse(String(init?.body ?? "{}")) as ProviderImportCreateInput;

      return jsonResponse({
        data: {
          importStatus: "imported",
          outcome: "new_import",
          partId: target.part.id,
          previousImportStatus: null,
          providerId: "local-catalog",
          providerPartKey: target.part.mpn,
          requestedLookup: target.part.mpn
        },
        source: "database"
      });
    }

    if (url.pathname === `/parts/${target.part.id}`) {
      return jsonResponse({
        data: buildPartDetailResponse(target, records, {
          completedAt: "2026-04-29T12:05:00.000Z",
          lastJobStatus: "succeeded",
          manufacturerName: target.manufacturer.name,
          mpn: target.part.mpn,
          providerId: "local-catalog",
          providerPartKey: target.part.mpn,
          reason: null,
          requestedAt: "2026-04-29T12:04:00.000Z",
          requestedBy: null,
          requestedLookup: target.part.mpn,
          sourceUrl: target.sources[0]?.sourceUrl ?? null,
          state: "available"
        }),
        source: "database"
      });
    }

    throw new Error(`Unexpected product-loop fetch: ${url.pathname}`);
  });

  try {
    const noMatchHtml = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: target.part.mpn }) })
    );

    assert.match(noMatchHtml, /Part not found/u);
    assert.match(noMatchHtml, /Search supported providers/u);
    assert.match(noMatchHtml, /Local catalog \(development\)/u);

    const importResult = await requestProviderImport({
      datasheetUrl: null,
      manufacturerName: target.manufacturer.name,
      mpn: target.part.mpn,
      providerId: "local-catalog",
      providerPartId: null,
      providerUrl: null
    });

    const capturedImportBody = requireCapturedImportBody(importBody);

    assert.equal(capturedImportBody.providerId, "local-catalog");
    assert.equal(capturedImportBody.mpn, target.part.mpn);
    assert.equal(importResult.partId, target.part.id);

    const detailHtml = renderToStaticMarkup(
      await PartDetailPage({ params: Promise.resolve({ partId: importResult.partId ?? "" }) })
    );

    assert.match(detailHtml, new RegExp(target.part.mpn, "u"));
    assert.match(detailHtml, new RegExp(target.manufacturer.name, "u"));
    assert.match(detailHtml, new RegExp(target.package.packageName, "u"));
    assert.match(detailHtml, /Lifecycle active/u);
    assert.match(detailHtml, /Use decision/u);
    assert.match(detailHtml, /Datasheet/u);
    assert.match(detailHtml, /CAD\/export/u);
    assert.match(detailHtml, /Source/u);
    assert.match(detailHtml, /Next action/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Returns the provider import body captured by the fetch mock, failing loudly if import never ran.
 */
function requireCapturedImportBody(body: ProviderImportCreateInput | null): ProviderImportCreateInput {
  assert.ok(body, "expected provider import request body to be captured");

  return body;
}

/**
 * Builds a minimal API health response for DB-backed catalog rendering.
 */
function buildHealthResponse() {
  return {
    dependencies: {
      database: "connected",
      objectStorage: "not_connected_phase_0",
      queue: "not_connected_phase_0"
    },
    service: "api",
    status: "ok"
  };
}

/**
 * Builds a SearchPagination object for mocked catalog search responses.
 */
function buildPagination(totalRecords: number): SearchPagination {
  return {
    page: 1,
    pageSize: 20,
    sort: "mpn_asc",
    totalPages: Math.max(1, Math.ceil(totalRecords / 20)),
    totalRecords
  };
}

/**
 * Replaces global fetch across the whole product-loop test and returns a restore callback.
 */
function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(input, init)) as typeof fetch;

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
