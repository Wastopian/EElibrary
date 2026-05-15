/**
 * File header: Tests the compare workspace route states against catalog detail API failures.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPartRecords } from "@ee-library/shared/search";
import { buildPartDetailResponse } from "../../../../api/src/detail-response";
import { CompareNoPartsRecovery } from "../../components/CompareRecoveryStates";
import { loadComparePage } from "../../lib/compare-page-loader";
import ComparePage from "./page";

/**
 * Verifies first-run compare guidance sends operators to normal workspaces instead of URL editing.
 */
test("compare empty recovery points users to catalog and projects", () => {
  const html = renderToStaticMarkup(React.createElement(CompareNoPartsRecovery));

  assert.match(html, /No parts selected/u);
  assert.match(html, /Find parts in Catalog/u);
  assert.match(html, /Open project BOMs/u);
  assert.doesNotMatch(html, /URL query string/u);
  assert.doesNotMatch(html, /\?parts/u);
});

/**
 * Verifies catalog setup failures render as setup guidance instead of an empty comparison.
 */
test("compare page renders setup guidance when detail records are unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (/^\/parts\/[^/]+$/u.test(url.pathname)) {
      return jsonResponse(
        {
          error: {
            code: "DB_NOT_CONFIGURED",
            message: "Catalog database is not configured."
          }
        },
        503
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve({ parts: "part-tps7a02dbvr" }) }));

    assert.match(html, /Part comparison/u);
    assert.match(html, /Connect the catalog database/u);
    assert.match(html, /Compare unavailable/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.doesNotMatch(html, /No matching parts found/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies manual compare entry can use a real manufacturer part number without requiring internal ids.
 */
test("compare loader resolves exact MPN tokens to detail records", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seed TPS7A02DBVR part");

  const restoreFetch = mockFetch((url) => {
    if (url.pathname === `/parts/${record.part.mpn}`) {
      return jsonResponse({ error: { code: "NOT_FOUND", message: "Part not found." } }, 404);
    }

    if (url.pathname === "/parts" && url.searchParams.get("q") === record.part.mpn) {
      return jsonResponse({
        data: [record],
        pagination: buildPagination(1),
        source: "database"
      });
    }

    if (url.pathname === `/parts/${record.part.id}`) {
      return jsonResponse({
        data: buildPartDetailResponse(record, records),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const state = await loadComparePage([record.part.mpn]);

    assert.equal(state.status, "ready");
    assert.equal(state.details.length, 1);
    assert.equal(state.details[0]?.record.part.id, record.part.id);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies exact MPN resolution stays conservative when search returns duplicate catalog identities.
 */
test("compare loader skips ambiguous exact MPN matches", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seed TPS7A02DBVR part");

  const duplicateRecord = {
    ...record,
    part: {
      ...record.part,
      id: "part-duplicate-tps7a02dbvr"
    }
  };
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === `/parts/${record.part.mpn}`) {
      return jsonResponse({ error: { code: "NOT_FOUND", message: "Part not found." } }, 404);
    }

    if (url.pathname === "/parts" && url.searchParams.get("q") === record.part.mpn) {
      return jsonResponse({
        data: [record, duplicateRecord],
        pagination: buildPagination(2),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const state = await loadComparePage([record.part.mpn]);

    assert.equal(state.status, "ready");
    assert.equal(state.details.length, 0);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the compare route mounts the side-by-side CAD preview band promised by
 * the product docs, not just the helper that prepares its rows.
 */
test("compare page mounts the CAD preview band beside trust-stage rows", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const trustStageIndex = source.indexOf('title="Per-asset trust-stage diff"');
  const previewIndex = source.indexOf("<CompareAssetPreviewBand rows={assetPreviewRows} />");

  assert.notEqual(trustStageIndex, -1);
  assert.notEqual(previewIndex, -1);
  assert.ok(previewIndex > trustStageIndex, "CAD preview should render directly after the per-asset trust-stage diff");
});

/**
 * Replaces global fetch with a small compare API handler.
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
 * Builds a SearchPagination object for compare search API responses.
 */
function buildPagination(totalRecords: number) {
  return {
    page: 1,
    pageSize: 20,
    sort: "mpn_asc",
    totalPages: Math.max(1, Math.ceil(totalRecords / 20)),
    totalRecords
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
