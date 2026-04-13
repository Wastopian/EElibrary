/**
 * File header: Tests explicit catalog source resolution without silent seed fallback.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CatalogStoreError } from "./catalog-store";
import { resolveCatalogRecords } from "./catalog-resolver";
import type { PartSearchRecord } from "@ee-library/shared/types";

/** emptySeedRead provides deterministic seed fallback content for resolver tests. */
const emptySeedRead = async (): Promise<PartSearchRecord[]> => [];

/**
 * Verifies schema mismatches surface as errors when fallback is not explicitly enabled.
 */
test("DB-backed catalog resolution does not mask schema mismatch with seed fallback", async () => {
  const result = await resolveCatalogRecords(
    async () => {
      throw new CatalogStoreError("schema_mismatch", "Catalog database schema does not match the API query contract.", { code: "42P01" });
    },
    emptySeedRead,
    {}
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.error.code, "SCHEMA_MISMATCH");
    assert.match(result.body.error.message, /EE_LIBRARY_ALLOW_SEED_FALLBACK=true/u);
  }
});

/**
 * Verifies seed fallback remains explicit and visible for local development.
 */
test("catalog resolution uses seed fallback only when explicitly allowed", async () => {
  const result = await resolveCatalogRecords(
    async () => ({ status: "not_configured" }),
    emptySeedRead,
    { EE_LIBRARY_ALLOW_SEED_FALLBACK: "true" }
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.source, "seed_fallback");
    assert.match(result.warnings?.[0] ?? "", /explicitly enabled/u);
  }
});
