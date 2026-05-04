/**
 * File header: Tests explicit API generation request persistence behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationRequestInDatabase } from "./catalog-store";

/**
 * Verifies generation request creation does not pretend to work without a database.
 */
test("createGenerationRequestInDatabase requires a configured database", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  delete process.env.DATABASE_URL;

  try {
    const result = await createGenerationRequestInDatabase("part-tps7a02dbvr", "symbol", "api-test", "2026-04-13T00:00:00.000Z");

    assert.equal(result.status, "not_configured");
  } finally {
    if (previousDatabaseUrl) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
