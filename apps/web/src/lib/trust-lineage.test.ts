/**
 * File header: Tests the four-stage trust lineage helper for part detail.
 *
 * The strip must keep `imported`, `reviewed`, `approved`, and `verified-for-export`
 * separate. None of the earlier stages may turn a later stage `passed` on its own.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getBundleReadinessSummary } from "@ee-library/shared/asset-resolution";
import { getPartDetail } from "@ee-library/shared/search";
import type {
  AssetPromotionSummary,
  PartApproval,
  PartSearchRecord,
  ReviewStatusSummary,
  SourceRecord
} from "@ee-library/shared/types";
import { buildCatalogTrustLineageBadges, getTrustLineageSummary, getTrustLineageSummaryForSearchRecord } from "./trust-lineage";

/**
 * Verifies the strip emits exactly the four stages in the right order, every time.
 */
test("trust lineage strip returns four stages in canonical order", () => {
  const record = getSeedRecord("part-te-215079-8");
  const summary = getTrustLineageSummary(record, getBundleReadinessSummary(record), [], [], []);

  assert.deepEqual(
    summary.stages.map((stage) => stage.stage),
    ["imported", "reviewed", "approved", "verified_for_export"]
  );
  assert.match(summary.boundary, /Each step is separate/u);
});

/**
 * Verifies `imported` only goes to `passed` when at least one source row is `imported`.
 */
test("imported stage stays separate from approval and review", () => {
  const record = getSeedRecord("part-te-215079-8");
  const failedSource: SourceRecord = { ...record.sources[0]!, importStatus: "failed" };
  const noSourceRecord = { ...record, sources: [] };
  const failedOnlyRecord = { ...record, sources: [failedSource] };

  const passed = getTrustLineageSummary(record, getBundleReadinessSummary(record), [], [], []).stages[0]!;
  const blocked = getTrustLineageSummary(failedOnlyRecord, getBundleReadinessSummary(failedOnlyRecord), [], [], []).stages[0]!;
  const pending = getTrustLineageSummary(noSourceRecord, getBundleReadinessSummary(noSourceRecord), [], [], []).stages[0]!;

  assert.equal(passed.state, "passed");
  assert.equal(blocked.state, "blocked");
  assert.equal(pending.state, "pending");
});

/**
 * Verifies the review stage tracks review records, not approval state.
 */
test("review stage reflects review records, not part approval", () => {
  const record = getSeedRecord("part-tps7a02dbvr");
  const baseBundle = getBundleReadinessSummary(record);
  const noReviews = getTrustLineageSummary(record, baseBundle, [], [], []).stages[1]!;
  const approvedReviews: ReviewStatusSummary[] = [
    {
      latestReview: null,
      state: "approved",
      targetId: record.assets[0]?.id ?? "asset-1",
      targetType: "asset"
    }
  ];
  const passed = getTrustLineageSummary(record, baseBundle, approvedReviews, [], []).stages[1]!;
  const rejectedReviews: ReviewStatusSummary[] = [{ ...approvedReviews[0]!, state: "rejected" }];
  const blocked = getTrustLineageSummary(record, baseBundle, rejectedReviews, [], []).stages[1]!;

  assert.equal(noReviews.state, "pending");
  assert.equal(passed.state, "passed");
  assert.equal(blocked.state, "blocked");
});

/**
 * Verifies the approved stage mirrors the persisted whole-part approval status.
 */
test("approved stage mirrors PartApproval.status without re-deriving it", () => {
  const baseRecord = getSeedRecord("part-tps7a02dbvr");
  const baseBundle = getBundleReadinessSummary(baseRecord);

  const overlay = (status: PartApproval["status"]): PartApproval => ({
    ...baseRecord.approval,
    detail: `Detail for ${status}`,
    status,
    summary: status
  });

  const cases: Array<[PartApproval["status"], "passed" | "pending" | "not_applicable"]> = [
    ["approved", "passed"],
    ["pending_review", "pending"],
    ["not_requested", "pending"],
    ["not_applicable", "not_applicable"]
  ];

  for (const [status, expected] of cases) {
    const record = { ...baseRecord, approval: overlay(status) };
    const stage = getTrustLineageSummary(record, baseBundle, [], [], []).stages[2]!;
    assert.equal(stage.state, expected, `expected ${expected} for ${status}, got ${stage.state}`);
  }
});

/**
 * Verifies verified-for-export only passes when bundle readiness reports verified CAD assets.
 */
test("verified-for-export stage requires bundle_ready and refuses to imply approval", () => {
  const connectorRecord = getSeedRecord("part-te-215079-8");
  const regulatorRecord = getSeedRecord("part-tps7a02dbvr");

  const connectorStage = getTrustLineageSummary(
    connectorRecord,
    getBundleReadinessSummary(connectorRecord),
    [],
    [],
    []
  ).stages[3]!;

  const regulatorStage = getTrustLineageSummary(
    regulatorRecord,
    getBundleReadinessSummary(regulatorRecord),
    [],
    [],
    []
  ).stages[3]!;

  assert.equal(connectorStage.state, "passed");
  assert.notEqual(regulatorStage.state, "passed");

  const promotionReady: AssetPromotionSummary[] = [
    {
      assetId: regulatorRecord.assets[0]?.id ?? "asset-1",
      blockerReasons: [],
      canPromote: true,
      label: "Ready to promote",
      latestPromotion: null,
      promotionHistory: []
    }
  ];

  const promotionPendingStage = getTrustLineageSummary(
    regulatorRecord,
    getBundleReadinessSummary(regulatorRecord),
    [],
    [],
    promotionReady
  ).stages[3]!;

  assert.equal(promotionPendingStage.state, "pending");
  assert.match(promotionPendingStage.detail, /promotion action/u);
});

/**
 * Verifies catalog badge rows preserve four distinct gates with stable abbreviations.
 */
test("buildCatalogTrustLineageBadges emits four abbreviated gates in canonical order", () => {
  const record = getSeedRecord("part-te-215079-8");
  const badges = buildCatalogTrustLineageBadges(record);

  assert.equal(badges.length, 4);
  assert.deepEqual(
    badges.map((badge) => badge.stageKey),
    ["imported", "reviewed", "approved", "verified_for_export"]
  );
  assert.deepEqual(badges.map((badge) => badge.abbrev), ["Import", "Review", "Approval", "Export"]);
});

/**
 * Verifies sparse catalog records without bundle readiness still resolve lineage using an explicit fallback.
 */
test("getTrustLineageSummaryForSearchRecord tolerates missing bundleReadiness", () => {
  const record = getSeedRecord("part-te-215079-8");
  const sparse = { ...record } as Record<string, unknown>;
  delete sparse.bundleReadiness;
  const summary = getTrustLineageSummaryForSearchRecord(sparse as unknown as PartSearchRecord);

  assert.equal(summary.stages.length, 4);
  assert.equal(summary.stages[3]!.stage, "verified_for_export");
});

function getSeedRecord(partId: string) {
  const record = getPartDetail(partId);
  assert.ok(record, `expected seed part ${partId}`);
  return record;
}
