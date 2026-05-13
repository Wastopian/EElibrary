/**
 * File header: Tests provider import request parsing and user-facing failure wording.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatProviderImportFailureMessage, parseProviderImportRequest } from "./provider-import-request";

test("parseProviderImportRequest rejects unknown providers", () => {
  const result = parseProviderImportRequest({ mpn: "X", providerId: "unknown-provider" });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected failure branch");
  }

  assert.equal(result.code, "UNKNOWN_PROVIDER");
});

test("parseProviderImportRequest requires a lookup value", () => {
  const missingBoth = parseProviderImportRequest({ datasheetUrl: "https://example.test/datasheet.pdf", mpn: "", providerId: "jlcparts", providerPartId: "" });
  assert.equal(missingBoth.ok, false);
  if (missingBoth.ok) {
    throw new Error("expected failure branch");
  }
  assert.equal(missingBoth.code, "MISSING_LOOKUP");

  const usesPartId = parseProviderImportRequest({ mpn: "", providerId: "jlcparts", providerPartId: "C1091" });
  assert.equal(usesPartId.ok, true);
  if (!usesPartId.ok) {
    throw new Error("expected success branch");
  }
  assert.equal(usesPartId.requestedLookup, "C1091");
  assert.equal(usesPartId.workerRequest.providerPartId, "C1091");
  assert.equal(usesPartId.workerRequest.mpn, undefined);
});

test("parseProviderImportRequest can derive a lookup from provider URL and preserves intake context", () => {
  const result = parseProviderImportRequest({
    datasheetUrl: "https://www.lcsc.com/datasheet/lcsc_datasheet_2411121005_FH--Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.pdf",
    providerId: "jlcparts",
    providerUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected success branch");
  }

  assert.equal(result.requestedLookup, "C1091");
  assert.equal(result.workerRequest.providerPartId, "C1091");
  assert.equal(result.workerRequest.mpn, undefined);
  assert.equal(result.workerRequest.providerUrl?.includes("C1091.html"), true);
  assert.equal(result.workerRequest.datasheetUrl?.includes("C1091.pdf"), true);
});

test("parseProviderImportRequest preserves a true MPN while keeping provider part ids separate", () => {
  const result = parseProviderImportRequest({
    mpn: "RC-02W300JT",
    providerId: "jlcparts",
    providerPartId: "C1091"
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected success branch");
  }

  assert.equal(result.workerRequest.mpn, "RC-02W300JT");
  assert.equal(result.workerRequest.providerPartId, "C1091");
});

test("formatProviderImportFailureMessage avoids raw DATABASE_URL jargon", () => {
  const message = formatProviderImportFailureMessage(new Error("DATABASE_URL is required for worker ingestion."));
  assert.match(message, /configured catalog database/u);
  assert.doesNotMatch(message, /DATABASE_URL/u);
});

test("formatProviderImportFailureMessage maps not-found imports to actionable copy", () => {
  const message = formatProviderImportFailureMessage(new Error("jlcparts metadata record not found for ABC123"));
  assert.match(message, /No matching catalog entry/u);
});

test("formatProviderImportFailureMessage maps Octopart credential and provider failures", () => {
  const missingCredentials = formatProviderImportFailureMessage(new Error("Octopart/Nexar credentials are not configured. Set NEXAR_ACCESS_TOKEN or NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET."));
  const unavailable = formatProviderImportFailureMessage(new Error("Unable to fetch Octopart/Nexar GraphQL response (401)"));

  assert.match(missingCredentials, /requires configured provider credentials/u);
  assert.match(unavailable, /Octopart\/Nexar provider/u);
  assert.doesNotMatch(missingCredentials, /CLIENT_SECRET/u);
});
