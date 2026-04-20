/**
 * File header: Tests the part detail readiness record rendering against backend-shaped data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPartRecords } from "@ee-library/shared/search";
import { buildPartDetailResponse } from "../../../../../api/src/detail-response";
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
    assert.match(html, /Review Needed/u);
    assert.match(html, /draft CAD needs review/u);
    assert.match(html, /Approved assets and generated outputs remain distinct/u);
    assert.match(html, /Engineering assets/u);
    assert.doesNotMatch(html, /approved part/u);
  } finally {
    restoreFetch();
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
