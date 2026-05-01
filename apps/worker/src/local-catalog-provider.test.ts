/**
 * File header: Tests deterministic exact provider lookup against the local-catalog adapter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { localCatalogProviderAdapter } from "./providers/local-catalog-provider";

test("local-catalog provider returns exact candidate rows for supported part lookups", async () => {
  const candidates = await localCatalogProviderAdapter.findExactPartCandidates({ query: "TPS7A02DBVR" });

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    manufacturerName: "Texas Instruments",
    matchConfidence: 1,
    matchType: "exact_mpn",
    mpn: "TPS7A02DBVR",
    package: "SOT-23-5",
    providerId: "local-catalog",
    providerPartKey: "TPS7A02DBVR",
    sourceUrl: "https://www.ti.com/product/TPS7A02"
  });
});

test("local-catalog provider enumerates several described sample parts for setup bootstrap", async () => {
  const requests = await localCatalogProviderAdapter.listAvailablePartRequests();
  const mpns = requests.map((request) => request.mpn).sort();

  assert.ok(mpns.includes("GRM188R71C104KA01D"));
  assert.ok(mpns.includes("STM32G031K8T6"));
  assert.ok(mpns.includes("TPS7A02DBVR"));
  assert.ok(mpns.length >= 3);
});

test("local-catalog provider normalizes sample descriptions for database inserts", async () => {
  const rawPayload = await localCatalogProviderAdapter.fetchRawPart({ mpn: "GRM188R71C104KA01D" });
  const normalized = localCatalogProviderAdapter.normalizeRawPart(rawPayload);

  assert.match(normalized.part.description, /ceramic capacitor/u);
});
