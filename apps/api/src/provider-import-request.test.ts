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
  const missingBoth = parseProviderImportRequest({ mpn: "", providerId: "jlcparts", providerPartId: "" });
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
