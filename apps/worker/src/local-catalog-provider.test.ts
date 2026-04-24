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
