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
