/**
 * File header: Tests API detail response assembly against the active catalog record set.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getAllPartRecords } from "@ee-library/shared/search";
import { buildPartDetailResponse } from "./detail-response";

/**
 * Verifies related part summaries use the provided record set, not seed globals.
 */
test("buildPartDetailResponse resolves related summaries from the provided records", () => {
  const records = getAllPartRecords().map((record) =>
    record.part.id === "part-te-215083-8"
      ? {
          ...record,
          part: {
            ...record.part,
            mpn: "DB-MATE-215083-8"
          }
        }
      : record
  );
  const record = records.find((candidate) => candidate.part.id === "part-te-215079-8");

  assert.ok(record, "expected seeded connector part");
  assert.equal(buildPartDetailResponse(record, records).relatedPartSummaries.some((summary) => summary.mpn === "DB-MATE-215083-8"), true);
});

/**
 * Verifies detail responses expose grouped assets, best assets, bundle readiness, generation options, and review state.
 */
test("buildPartDetailResponse returns asset pipeline and review workflow fields", () => {
  const records = getAllPartRecords();
  const regulatorRecord = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");
  const bundleReadyRecord = records.find((candidate) => candidate.part.id === "part-grm188r71c104ka01d");

  assert.ok(regulatorRecord, "expected seeded regulator part");
  assert.ok(bundleReadyRecord, "expected seeded bundle-ready capacitor part");

  const regulatorResponse = buildPartDetailResponse(regulatorRecord, records);
  const bundleReadyResponse = buildPartDetailResponse(bundleReadyRecord, records);

  assert.deepEqual(regulatorResponse.assetGroups.map((group) => group.assetType), ["symbol", "footprint", "three_d_model", "datasheet", "mechanical_drawing"]);
  assert.equal(regulatorResponse.assetGroups.find((group) => group.assetType === "mechanical_drawing")?.bestAsset?.id, "asset-tps7a02-mechanical");
  assert.equal(regulatorResponse.bundleReadiness.state, "partial_bundle");
  assert.deepEqual(regulatorResponse.generationOptions.map((option) => option.label), ["Generate footprint from datasheet", "Generate symbol from pin table", "Generate 3D from mechanical drawing"]);
  assert.deepEqual(regulatorResponse.generationOptions.map((option) => option.workflowStatus), ["available_to_request", "available_to_request", "review_required"]);
  assert.equal(regulatorResponse.assetReviewStatuses.find((status) => status.targetId === "asset-tps7a02-3d")?.state, "pending_review");
  assert.equal(regulatorResponse.workflowReviewStatuses.find((status) => status.targetId === "gen-tps7a02-3d")?.state, "pending_review");
  assert.equal(bundleReadyResponse.bundleReadiness.state, "bundle_ready");
  assert.equal(bundleReadyResponse.generationOptions.length, 0);
});
