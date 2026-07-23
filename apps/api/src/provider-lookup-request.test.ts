/**
 * File header: Tests exact provider lookup request parsing and package-query rejection.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatProviderLookupFailureMessage, formatProviderLookupProviderFailureMessage, parseProviderLookupRequest } from "./provider-lookup-request";

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

test("formatProviderLookupFailureMessage maps Octopart provider failures without leaking internals", () => {
  const message = formatProviderLookupFailureMessage(new Error("Octopart/Nexar GraphQL returned errors: Forbidden field"));

  assert.match(message, /supported provider catalog/u);
  assert.match(message, /credentials/u);
  assert.doesNotMatch(message, /Forbidden field/u);
});

test("formatProviderLookupProviderFailureMessage points credential-shaped failures at credentials", () => {
  const expiredToken = formatProviderLookupProviderFailureMessage({
    message: "Unable to fetch DigiKey access token (401)",
    providerId: "digikey",
    providerName: "DigiKey Product Information API"
  });
  const forbidden = formatProviderLookupProviderFailureMessage({
    message: "Octopart/Nexar GraphQL returned errors: Forbidden field",
    providerId: "octopart",
    providerName: "Octopart via Nexar GraphQL"
  });

  assert.equal(expiredToken, "DigiKey did not answer — check credentials.");
  assert.equal(forbidden, "Octopart/Nexar did not answer — check credentials.");
});

test("formatProviderLookupProviderFailureMessage keeps non-credential failures calm without leaking internals", () => {
  const message = formatProviderLookupProviderFailureMessage({
    message: "Unable to fetch Mouser response (503)",
    providerId: "mouser",
    providerName: "Mouser Search API"
  });
  const unknownProvider = formatProviderLookupProviderFailureMessage({
    message: "socket hang up",
    providerId: "future-provider",
    providerName: "Future Provider API"
  });

  assert.equal(message, "Mouser did not answer — check network access and try again.");
  assert.doesNotMatch(message, /503/u);
  assert.equal(unknownProvider, "Future Provider API did not answer — check network access and try again.");
});
