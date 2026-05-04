/**
 * File header: Tests backend-derived whole-part readiness, approval, issue, and risk projections.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getPartDetail } from "./search";

/**
 * Verifies a connector record exposes backend-derived readiness, approval, issues, and risk flags.
 */
test("connector record exposes derived readiness, approval, and connector class", () => {
  const record = getPartDetail("part-te-215079-8");

  assert.ok(record, "expected connector seed record");
  assert.equal(record.readinessSummary.connectorClass, "connector");
  assert.equal(record.approval.status, "approved");
  assert.equal(record.readinessSummary.status, "ready_for_export_review");
  assert.equal(record.issues.some((issue) => issue.code === "connector_low_confidence"), true);
  assert.equal(record.issues.find((issue) => issue.code === "connector_low_confidence")?.severity, "warning");
  assert.equal(record.issues.some((issue) => issue.code === "missing_verified_cad"), false);
});

/**
 * Verifies a generated-draft record surfaces review and data risks explicitly.
 */
test("generated draft record surfaces approval and risk follow-up", () => {
  const record = getPartDetail("part-tps7a02dbvr");

  assert.ok(record, "expected generated-draft seed record");
  assert.equal(record.approval.status, "pending_review");
  assert.equal(record.readinessSummary.status, "blocked");
  assert.equal(record.riskFlags.some((flag) => flag.code === "generated_assets_present"), true);
  assert.equal(record.issues.some((issue) => issue.code === "pending_approval"), true);
});

/**
 * Verifies a fully verified seed record can surface the ready-for-export-review state.
 */
test("fully verified record can surface ready-for-export-review status", () => {
  const record = getPartDetail("part-grm188r71c104ka01d");

  assert.ok(record, "expected fully verified seed record");
  assert.equal(record.readinessSummary.status, "ready_for_export_review");
  assert.equal(record.approval.status, "approved");
  assert.equal(record.issues.some((issue) => issue.code === "missing_verified_cad"), false);
});
