/**
 * File header: Tests import panel shell copy and provider import API client behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { requestProviderImport } from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import { ImportByMpnPanel } from "./ImportByMpnPanel";

test("ImportByMpnPanel renders honest idle copy and primary route targets", () => {
  const html = renderToStaticMarkup(React.createElement(ImportByMpnPanel, { anchorId: "import-by-mpn" }));

  assert.match(html, /same import path as the worker CLI/u);
  assert.match(html, /does not verify CAD files or export bundles/u);
  assert.match(html, new RegExp(importUiCopy.buttonSubmit, "u"));
  assert.match(html, /id="import-by-mpn"/u);
});

test("importUiCopy success wording does not imply export readiness", () => {
  assert.match(importUiCopy.successLead, /CAD and export readiness are unchanged/u);
  assert.doesNotMatch(importUiCopy.successLead, /exportable/u);
});

test("requestProviderImport posts to the provider import route", async () => {
  const restoreFetch = mockFetch((url, init) => {
    assert.equal(url.pathname, "/imports/provider");
    assert.equal(init?.method, "POST");
    assert.ok(typeof init?.body === "string");
    assert.match(init?.body as string, /jlcparts/u);

    return jsonResponse({
      data: {
        importStatus: "imported",
        partId: "part-jlcparts-c1091",
        providerId: "jlcparts",
        providerPartKey: "C1091",
        requestedLookup: "C1091"
      },
      source: "database"
    });
  });

  try {
    const result = await requestProviderImport({ mpn: "RC-02W300JT", providerId: "jlcparts" });

    assert.equal(result.partId, "part-jlcparts-c1091");
    assert.equal(result.importStatus, "imported");
  } finally {
    restoreFetch();
  }
});

test("requestProviderImport surfaces API errors without claiming success", async () => {
  const restoreFetch = mockFetch(() =>
    jsonResponse(
      {
        error: {
          code: "PROVIDER_IMPORT_FAILED",
          message: "No matching catalog entry was found for that lookup."
        }
      },
      422
    )
  );

  try {
    await requestProviderImport({ mpn: "ZZZZ-NOT-REAL", providerId: "jlcparts" });
    assert.fail("expected requestProviderImport to throw");
  } catch (error: unknown) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /No matching catalog entry/u);
  } finally {
    restoreFetch();
  }
});

function mockFetch(handler: (url: URL, init?: RequestInit) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}
