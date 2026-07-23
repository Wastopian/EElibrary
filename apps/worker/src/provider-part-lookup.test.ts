/**
 * File header: Tests the settled provider lookup fan-out so one failing adapter cannot hide answers from the rest.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runProviderPartLookupSettled } from "./provider-part-lookup";
import type { ProviderAdapter } from "./provider-adapters";
import type { ProviderLookupCandidateBase } from "@ee-library/shared/types";

test("settled provider lookup keeps candidates from adapters that answered and records per-adapter failures", async () => {
  const result = await runProviderPartLookupSettled({ query: "RC-02W300JT" }, [
    buildLookupAdapter("jlcparts", "JLCPCB Parts", async () => [buildCandidate("jlcparts", "C1091")]),
    buildLookupAdapter("digikey", "DigiKey", async () => {
      throw new Error("Unable to fetch DigiKey access token (401)");
    }),
    buildLookupAdapter("mouser", "Mouser", async () => [buildCandidate("mouser", "71-RC-02W300JT")])
  ]);

  assert.deepEqual(
    result.candidates.map((candidate) => `${candidate.providerId}:${candidate.providerPartKey}`),
    ["jlcparts:C1091", "mouser:71-RC-02W300JT"]
  );
  assert.deepEqual(result.failures, [
    {
      message: "Unable to fetch DigiKey access token (401)",
      providerId: "digikey",
      providerName: "DigiKey"
    }
  ]);
});

test("settled provider lookup reports every adapter failure instead of pretending an empty result means not found", async () => {
  const result = await runProviderPartLookupSettled({ query: "RC-02W300JT" }, [
    buildLookupAdapter("digikey", "DigiKey", async () => {
      throw new Error("Unable to fetch DigiKey access token (401)");
    }),
    buildLookupAdapter("mouser", "Mouser", async () => {
      throw new Error("Unable to fetch Mouser response (503)");
    })
  ]);

  assert.equal(result.candidates.length, 0);
  assert.deepEqual(
    result.failures.map((failure) => failure.providerId),
    ["digikey", "mouser"]
  );
});

test("settled provider lookup dedupes repeat candidate rows and reports no failures when every adapter answers", async () => {
  const result = await runProviderPartLookupSettled({ query: "C1091" }, [
    buildLookupAdapter("jlcparts", "JLCPCB Parts", async () => [buildCandidate("jlcparts", "C1091")]),
    buildLookupAdapter("local-catalog", "Local Catalog", async () => [buildCandidate("jlcparts", "C1091")])
  ]);

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.failures, []);
});

/**
 * Builds a lookup-only adapter stub; ingestion methods stay unused in these tests.
 */
function buildLookupAdapter(
  id: string,
  name: string,
  findExactPartCandidates: ProviderAdapter["findExactPartCandidates"]
): ProviderAdapter {
  return {
    fetchRawPart: async () => {
      throw new Error("fetchRawPart is not used in lookup tests");
    },
    findExactPartCandidates,
    id,
    listAvailablePartRequests: async () => [],
    name,
    normalizeRawPart: () => {
      throw new Error("normalizeRawPart is not used in lookup tests");
    }
  };
}

/**
 * Builds one exact-match candidate row for settled fan-out tests.
 */
function buildCandidate(providerId: string, providerPartKey: string): ProviderLookupCandidateBase {
  return {
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId,
    providerPartKey,
    sourceUrl: null
  };
}
