/**
 * File header: Tests import panel shell copy and provider import API client behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientError, requestProviderImport, requestProviderLookup } from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import { ImportByMpnPanel, ImportByMpnPanelStatus, resolveCanonicalImportRouteTarget, resolveImportFailureState, resolveImportSuccessAction, resolvePartDetailRouteTarget } from "./ImportByMpnPanel";

test("ImportByMpnPanel renders honest idle copy and primary route targets", () => {
  const html = renderToStaticMarkup(React.createElement(ImportByMpnPanel, { anchorId: "import-by-mpn" }));

  assert.match(html, /Import one exact part number/u);
  assert.match(html, /does not verify CAD files or export bundles/u);
  assert.match(html, new RegExp(importUiCopy.buttonSubmit, "u"));
  assert.match(html, /Octopart \/ Nexar/u);
  assert.match(html, /id="import-by-mpn"/u);
});

test("ImportByMpnPanel supports catalog acquisition from no-match without implying live global search", () => {
  const html = renderToStaticMarkup(
    React.createElement(ImportByMpnPanel, {
      autoRedirectOnSuccess: true,
      compact: true,
      initialMpn: "TPS7A02DBVR",
      refreshHref: "/?q=TPS7A02DBVR"
    })
  );

  assert.match(html, /Import this exact part number/u);
  assert.match(html, /Exact part-number import only/u);
  assert.match(html, /Octopart\/Nexar/u);
  assert.match(html, /value="TPS7A02DBVR"/u);
  assert.match(html, new RegExp(importUiCopy.buttonAcquireNoMatch, "u"));
  assert.match(html, /Add provider-specific lookup context/u);
  assert.doesNotMatch(html, /Advanced: worker CLI/u);
});

test("ImportByMpnPanel supports selected provider-candidate prefills without duplicating the import form", () => {
  const html = renderToStaticMarkup(
    React.createElement(ImportByMpnPanel, {
      compact: true,
      initialManufacturerName: "Guangdong Fenghua Advanced Tech",
      initialMpn: "RC-02W300JT",
      initialProviderId: "jlcparts",
      initialProviderPartId: "C1091",
      initialProviderUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html",
      refreshHref: "/?q=RC-02W300JT"
    })
  );

  assert.match(html, /value="RC-02W300JT"/u);
  assert.match(html, /value="C1091"/u);
  assert.match(html, /Guangdong Fenghua Advanced Tech/u);
  assert.match(html, /C1091\.html/u);
});

test("importUiCopy success wording does not imply export readiness", () => {
  assert.match(importUiCopy.successLead, /CAD and export readiness are unchanged/u);
  assert.doesNotMatch(importUiCopy.successLead, /exportable/u);
});

test("catalog acquisition import failures distinguish unavailable import from normal provider failure", () => {
  const unauthorized = resolveImportFailureState(new ApiClientError("Provider import", 401, "UNAUTHORIZED", "Authentication is required for this operation."));
  const forbidden = resolveImportFailureState(new ApiClientError("Provider import", 403, "FORBIDDEN", "Admin role is required for this operation."));
  const dbUnavailable = resolveImportFailureState(new ApiClientError("Provider import", 503, "DB_NOT_CONFIGURED", "Catalog database is not configured."));
  const failed = resolveImportFailureState(new ApiClientError("Provider import", 422, "PROVIDER_IMPORT_FAILED", "No matching catalog entry was found for that lookup."));

  assert.equal(unauthorized.kind, "unavailable");
  assert.match(unauthorized.message, /admin sign-in/i);
  assert.equal(forbidden.kind, "unavailable");
  assert.match(forbidden.message, /admin sign-in/i);
  assert.equal(dbUnavailable.kind, "unavailable");
  assert.match(dbUnavailable.message, /catalog database to be connected/i);
  assert.equal(failed.kind, "failed");
  assert.match(failed.message, /No matching catalog entry/u);
});

test("compact panel renders unavailable status markup for mocked 401 and 403 failures", () => {
  for (const error of [
    new ApiClientError("Provider import", 401, "UNAUTHORIZED", "Authentication is required for this operation."),
    new ApiClientError("Provider import", 403, "FORBIDDEN", "Admin role is required for this operation.")
  ]) {
    const html = renderToStaticMarkup(React.createElement(ImportByMpnPanelStatus, { status: resolveImportFailureState(error) }));

    assert.match(html, /import-by-mpn-panel__status--unavailable/u);
    assert.match(html, /admin sign-in/i);
  }
});

test("catalog acquisition only auto-navigates when the import response has a usable part route target", () => {
  assert.equal(resolvePartDetailRouteTarget("part-jlcparts-c1091"), "/parts/part-jlcparts-c1091");
  assert.equal(resolvePartDetailRouteTarget("   "), null);
  assert.equal(resolvePartDetailRouteTarget(null), null);
  assert.equal(resolveCanonicalImportRouteTarget("/parts/part-jlcparts-c1091"), "/parts/part-jlcparts-c1091");
  assert.equal(resolveCanonicalImportRouteTarget("https://example.com/parts/part-jlcparts-c1091"), null);
});

test("successful compact acquisition prefers the imported part detail route when a usable part id exists", () => {
  const action = resolveImportSuccessAction({
    partId: "part-jlcparts-c1091",
    refreshHref: "/?q=TPS7A02DBVR"
  });

  assert.deepEqual(action, {
    href: "/parts/part-jlcparts-c1091",
    kind: "open_part"
  });
});

test("successful compact acquisition refreshes search results instead of guessing a route when no part target exists", () => {
  const action = resolveImportSuccessAction({
    partId: "   ",
    refreshHref: "/?q=TPS7A02DBVR"
  });

  assert.deepEqual(action, {
    href: "/?q=TPS7A02DBVR",
    kind: "refresh_search"
  });
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

test("requestProviderLookup posts to the provider lookup route", async () => {
  const restoreFetch = mockFetch((url, init) => {
    assert.equal(url.pathname, "/provider-lookups");
    assert.equal(init?.method, "POST");
    assert.ok(typeof init?.body === "string");
    assert.match(init?.body as string, /C1091/u);

    return jsonResponse({
      data: {
        candidates: [
          {
            importAllowed: false,
            manufacturerName: "Guangdong Fenghua Advanced Tech",
            matchConfidence: 1,
            matchType: "exact_provider_part_id",
            mpn: "RC-02W300JT",
            package: "0402",
            providerId: "jlcparts",
            providerPartKey: "C1091",
            sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
          }
        ],
        providerFailures: [
          {
            message: "DigiKey did not answer — check credentials.",
            providerId: "digikey",
            providerName: "DigiKey"
          }
        ]
      }
    });
  });

  try {
    const result = await requestProviderLookup({ query: "C1091" });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.providerPartKey, "C1091");
    assert.equal(result.candidates[0]?.importAllowed, false);
    assert.equal(result.providerFailures[0]?.providerId, "digikey");
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
