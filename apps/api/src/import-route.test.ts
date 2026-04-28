/**
 * File header: Tests body validation and HTTP outcome shaping for POST /parts/import.
 * The runDirectImport runner is faked here so we exercise routing logic without a live DB.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { handleImportRequest, parseImportBody } from "./import-route";
import type { DirectImportResult } from "@ee-library/worker/direct-import";

test("parseImportBody rejects non-object bodies", () => {
  assert.equal(parseImportBody(null).kind, "rejected");
  assert.equal(parseImportBody("TPS7A02DBVR").kind, "rejected");
  assert.equal(parseImportBody([]).kind, "rejected");
});

test("parseImportBody rejects bodies missing mpn", () => {
  const result = parseImportBody({ providerId: "local-catalog" });
  assert.equal(result.kind, "rejected");
  if (result.kind === "rejected") {
    assert.equal(result.reason, "missing_mpn");
  }
});

test("parseImportBody rejects vague keyword queries with vague_query", () => {
  for (const vague of ["regulator", "0603", "low dropout", "abc", "0.1uF"]) {
    const result = parseImportBody({ mpn: vague });
    assert.equal(result.kind, "rejected", `expected rejection for ${vague}`);
    if (result.kind === "rejected") {
      assert.equal(result.reason, "vague_query");
    }
  }
});

test("parseImportBody accepts and uppercases an exact MPN", () => {
  const result = parseImportBody({ mpn: "tps7a02dbvr" });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.mpn, "TPS7A02DBVR");
    assert.equal(result.providerId, undefined);
  }
});

test("parseImportBody preserves an explicit providerId", () => {
  const result = parseImportBody({ mpn: "TPS7A02DBVR", providerId: "local-catalog" });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.providerId, "local-catalog");
  }
});

test("handleImportRequest returns 201 with partId on a fresh import", async () => {
  const fakeRunner = async (): Promise<DirectImportResult> => ({
    alreadyExisted: false,
    mpn: "TPS7A02DBVR",
    partId: "part-tps7a02dbvr",
    providerId: "local-catalog",
    status: "imported"
  });

  const outcome = await handleImportRequest({ mpn: "TPS7A02DBVR" }, { runImport: fakeRunner });
  assert.equal(outcome.statusCode, 201);
  assert.equal(outcome.body.status, "imported");
  if (outcome.body.status === "imported") {
    assert.equal(outcome.body.partId, "part-tps7a02dbvr");
    assert.equal(outcome.body.alreadyExisted, false);
  }
});

test("handleImportRequest returns 200 when the part already existed", async () => {
  const fakeRunner = async (): Promise<DirectImportResult> => ({
    alreadyExisted: true,
    mpn: "TPS7A02DBVR",
    partId: "part-tps7a02dbvr",
    providerId: "local-catalog",
    status: "imported"
  });

  const outcome = await handleImportRequest({ mpn: "TPS7A02DBVR" }, { runImport: fakeRunner });
  assert.equal(outcome.statusCode, 200);
  if (outcome.body.status === "imported") {
    assert.equal(outcome.body.alreadyExisted, true);
  }
});

test("handleImportRequest maps provider_part_not_found to 404 with provider-specific reason", async () => {
  const fakeRunner = async (): Promise<DirectImportResult> => ({
    message: "Local catalog part not found: NOPE-1",
    mpn: "NOPE-1",
    providerId: "local-catalog",
    reason: "provider_part_not_found",
    status: "failed"
  });

  const outcome = await handleImportRequest({ mpn: "NOPE-1" }, { runImport: fakeRunner });
  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.status, "failed");
  if (outcome.body.status === "failed") {
    assert.equal(outcome.body.reason, "provider_part_not_found");
    assert.match(outcome.body.message, /not found/iu);
  }
});

test("handleImportRequest maps provider_fetch_failed to 502", async () => {
  const fakeRunner = async (): Promise<DirectImportResult> => ({
    message: "HTTP 500 from upstream",
    mpn: "BOOM-1",
    providerId: "local-catalog",
    reason: "provider_fetch_failed",
    status: "failed"
  });

  const outcome = await handleImportRequest({ mpn: "BOOM-1" }, { runImport: fakeRunner });
  assert.equal(outcome.statusCode, 502);
});

test("handleImportRequest rejects vague queries with 400 before calling the runner", async () => {
  let runnerCalled = false;
  const fakeRunner = async (): Promise<DirectImportResult> => {
    runnerCalled = true;
    return { alreadyExisted: false, mpn: "x", partId: "x", providerId: "x", status: "imported" };
  };

  const outcome = await handleImportRequest({ mpn: "regulator" }, { runImport: fakeRunner });
  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.status, "rejected");
  assert.equal(runnerCalled, false, "runner must not be called for vague queries");
});
