/**
 * File header: Tests exact provider lookup request parsing and package-query rejection.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderLookupRequest } from "./provider-lookup-request";

test("parseProviderLookupRequest rejects missing and unsupported lookup values", () => {
  const missingLookup = parseProviderLookupRequest({ query: "" });
  assert.equal(missingLookup.ok, false);
  if (missingLookup.ok) {
    throw new Error("expected failure branch");
  }
  assert.equal(missingLookup.code, "MISSING_LOOKUP");

  const packageLookup = parseProviderLookupRequest({ query: "QFN-16" });
  assert.equal(packageLookup.ok, false);
  if (packageLookup.ok) {
    throw new Error("expected failure branch");
  }
  assert.equal(packageLookup.code, "LOOKUP_NOT_SUPPORTED");
});

test("parseProviderLookupRequest accepts concrete exact lookup values including numeric-only MPNs", () => {
  const numericLookup = parseProviderLookupRequest({ query: "0430250200" });
  assert.equal(numericLookup.ok, true);
  if (!numericLookup.ok) {
    throw new Error("expected success branch");
  }
  assert.equal(numericLookup.lookupRequest.query, "0430250200");

  const providerIdLookup = parseProviderLookupRequest({ manufacturerName: "FH", query: "C1091" });
  assert.equal(providerIdLookup.ok, true);
  if (!providerIdLookup.ok) {
    throw new Error("expected success branch");
  }
  assert.equal(providerIdLookup.lookupRequest.query, "C1091");
  assert.equal(providerIdLookup.lookupRequest.manufacturerName, "FH");
});
