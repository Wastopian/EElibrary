/**
 * File header: Tests provider acquisition job request validation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderAcquisitionJobCreateRequest } from "./provider-acquisition-request";

test("parseProviderAcquisitionJobCreateRequest rejects unsupported bodies and non-exact candidates", () => {
  const invalidBody = parseProviderAcquisitionJobCreateRequest(null);
  const invalidMatchType = parseProviderAcquisitionJobCreateRequest({
    matchConfidence: 1,
    matchType: "fuzzy",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT"
  });
  const invalidConfidence = parseProviderAcquisitionJobCreateRequest({
    matchConfidence: 0.8,
    matchType: "exact_mpn",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT"
  });

  assert.equal(invalidBody.ok, false);
  assert.equal(invalidMatchType.ok, false);
  assert.equal(invalidConfidence.ok, false);

  if (invalidBody.ok || invalidMatchType.ok || invalidConfidence.ok) {
    throw new Error("expected validation failures");
  }

  assert.equal(invalidBody.code, "INVALID_BODY");
  assert.equal(invalidMatchType.code, "INVALID_MATCH_TYPE");
  assert.equal(invalidConfidence.code, "INVALID_MATCH_CONFIDENCE");
});

test("parseProviderAcquisitionJobCreateRequest preserves candidate context for exact acquisition jobs", () => {
  const result = parseProviderAcquisitionJobCreateRequest({
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT",
    sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected success branch");
  }

  assert.deepEqual(result.jobInput, {
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT",
    sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  });
});
