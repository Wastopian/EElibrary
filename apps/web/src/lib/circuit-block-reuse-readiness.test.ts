/**
 * File header: Tests the four-stage reuse-readiness helper for circuit block detail.
 *
 * The strip must keep `defined`, `roles_complete`, `parts_ready`, and `reusable`
 * separate. None of the earlier stages may turn a later stage `passed` on its own,
 * and block-level reuse must never imply part-level approval or export readiness.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  CircuitBlock,
  CircuitBlockDetailResponse,
  CircuitBlockStatus,
  CircuitBlockSummary
} from "@ee-library/shared/types";
import {
  getCircuitBlockReuseHeadline,
  getCircuitBlockReuseReadiness,
  getCircuitBlockReuseReadinessFromSummary,
  matchesReuseReadinessFilter
} from "./circuit-block-reuse-readiness";

/**
 * Verifies the strip emits exactly the four stages in the right order, every time.
 */
test("circuit block reuse readiness returns four stages in canonical order", () => {
  const detail = buildDetail({ status: "approved" });
  const summary = getCircuitBlockReuseReadiness(detail);

  assert.deepEqual(
    summary.stages.map((stage) => stage.stage),
    ["defined", "roles_complete", "parts_ready", "reusable"]
  );
  assert.match(summary.boundary, /Block reuse is separate from part approval/u);
});

/**
 * Verifies the defined stage flips to pending when no engineering identity is recorded.
 */
test("defined stage stays pending when owner, scope, and description are empty", () => {
  const empty = buildDetail({
    blockOverrides: { description: "", owner: null, reuseScope: "" },
    status: "draft"
  });
  const stage = getCircuitBlockReuseReadiness(empty).stages[0]!;

  assert.equal(stage.stage, "defined");
  assert.equal(stage.state, "pending");
  assert.match(stage.detail, /No owner, reuse scope, or description/u);
});

/**
 * Verifies a deprecated block reports the defined stage as blocked, not silently passed.
 */
test("defined stage reports blocked on deprecated blocks", () => {
  const stage = getCircuitBlockReuseReadiness(buildDetail({ status: "deprecated" })).stages[0]!;

  assert.equal(stage.state, "blocked");
  assert.match(stage.detail, /deprecated/u);
});

/**
 * Verifies the roles_complete stage requires at least one required part role.
 */
test("roles_complete stage stays pending when no required roles exist", () => {
  const noRoles = buildDetail({
    status: "approved",
    summaryOverrides: {
      approvedPartCount: 0,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 0,
      strictSubstitutionCount: 0,
      totalPartCount: 0
    }
  });
  const optionalOnly = buildDetail({
    status: "approved",
    summaryOverrides: {
      approvedPartCount: 0,
      lifecycleRiskCount: 0,
      optionalPartCount: 2,
      readinessGapCount: 0,
      requiredPartCount: 0,
      strictSubstitutionCount: 0,
      totalPartCount: 2
    }
  });

  assert.equal(getCircuitBlockReuseReadiness(noRoles).stages[1]!.state, "pending");
  assert.match(getCircuitBlockReuseReadiness(noRoles).stages[1]!.detail, /Add at least one required/u);
  assert.equal(getCircuitBlockReuseReadiness(optionalOnly).stages[1]!.state, "pending");
  assert.match(getCircuitBlockReuseReadiness(optionalOnly).stages[1]!.detail, /No required roles/u);
});

/**
 * Verifies the parts_ready stage surfaces lifecycle risk on linked parts as blocked,
 * and readiness gaps as blocked but distinct.
 */
test("parts_ready stage surfaces lifecycle risk and readiness gaps separately", () => {
  const lifecycle = buildDetail({
    status: "approved",
    summaryOverrides: {
      approvedPartCount: 1,
      lifecycleRiskCount: 1,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  });
  const readinessGap = buildDetail({
    status: "approved",
    summaryOverrides: {
      approvedPartCount: 0,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      readinessGapCount: 1,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  });
  const ready = buildDetail({
    status: "approved",
    summaryOverrides: {
      approvedPartCount: 2,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 2,
      strictSubstitutionCount: 0,
      totalPartCount: 2
    }
  });

  const lifecycleStage = getCircuitBlockReuseReadiness(lifecycle).stages[2]!;
  const readinessStage = getCircuitBlockReuseReadiness(readinessGap).stages[2]!;
  const readyStage = getCircuitBlockReuseReadiness(ready).stages[2]!;

  assert.equal(lifecycleStage.state, "blocked");
  assert.equal(lifecycleStage.tone, "danger");
  assert.match(lifecycleStage.detail, /obsolete or not-recommended/u);

  assert.equal(readinessStage.state, "blocked");
  assert.match(readinessStage.detail, /approval or readiness blockers/u);

  assert.equal(readyStage.state, "passed");
  assert.equal(readyStage.tone, "verified");
  assert.match(readyStage.detail, /2 of 2/u);
});

/**
 * Verifies the reusable stage mirrors CircuitBlock.status without re-deriving it.
 */
test("reusable stage mirrors CircuitBlock.status without re-deriving it", () => {
  const cases: Array<[CircuitBlockStatus, "passed" | "pending" | "blocked" | "not_applicable"]> = [
    ["approved", "passed"],
    ["in_review", "pending"],
    ["draft", "pending"],
    ["restricted", "blocked"],
    ["deprecated", "not_applicable"]
  ];

  for (const [status, expected] of cases) {
    const stage = getCircuitBlockReuseReadiness(buildDetail({ status })).stages[3]!;

    assert.equal(stage.state, expected, `expected reusable stage ${expected} for ${status}`);
  }
});

/**
 * Verifies that earlier stage success does not pass later stages on its own.
 *
 * A draft block can still be "defined" + "roles_complete" + "parts_ready" without
 * being "reusable". That separation is the whole point of the strip.
 */
test("earlier stages never pass later stages on their own", () => {
  const draft = buildDetail({
    status: "draft",
    summaryOverrides: {
      approvedPartCount: 1,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  });
  const summary = getCircuitBlockReuseReadiness(draft);

  assert.equal(summary.stages[0]!.state, "passed");
  assert.equal(summary.stages[1]!.state, "passed");
  assert.equal(summary.stages[2]!.state, "passed");
  assert.equal(summary.stages[3]!.state, "pending");
});

/**
 * Verifies unresolved blocking known risks gate the reusable-stage verdict regardless of status.
 *
 * The reusable stage is the only gate that responds to known risks; lower severities are
 * surfaced elsewhere but never block reuse. A deprecated block continues to report retired
 * (the deprecation-state rule wins).
 */
test("reusable stage is blocked by unresolved blocking known risks", () => {
  const approvedWithBlockingRisk = buildDetail({
    status: "approved",
    summaryOverrides: {
      activeBlockingRiskCount: 1,
      activeKnownRiskCount: 2,
      approvedPartCount: 1,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  });
  const approvedWithNonBlockingRisks = buildDetail({
    status: "approved",
    summaryOverrides: {
      activeBlockingRiskCount: 0,
      activeKnownRiskCount: 3,
      approvedPartCount: 1,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  });
  const deprecatedWithBlockingRisk = buildDetail({
    status: "deprecated",
    summaryOverrides: { activeBlockingRiskCount: 1, activeKnownRiskCount: 1 }
  });

  const blockedReadiness = getCircuitBlockReuseReadiness(approvedWithBlockingRisk).stages[3]!;
  assert.equal(blockedReadiness.state, "blocked");
  assert.match(blockedReadiness.detail, /unresolved blocking risk/iu);

  const blockedHeadline = getCircuitBlockReuseHeadline(approvedWithBlockingRisk.summary);
  assert.equal(blockedHeadline.state, "blocked");
  assert.equal(blockedHeadline.stage, "reusable");

  // Non-blocking risks must not gate readiness, but should appear in the detail copy as context.
  const cautionReadiness = getCircuitBlockReuseReadiness(approvedWithNonBlockingRisks).stages[3]!;
  assert.equal(cautionReadiness.state, "passed");
  assert.match(cautionReadiness.detail, /3 open non-blocking/u);

  // Deprecation still wins over known-risk gating; the block reports retired, not blocked.
  const deprecatedReadiness = getCircuitBlockReuseReadiness(deprecatedWithBlockingRisk).stages[3]!;
  assert.equal(deprecatedReadiness.state, "not_applicable");
});

/**
 * Verifies the headline helper collapses to "Ready to reuse" for fully approved blocks.
 */
test("reuse headline reports ready when every stage passes", () => {
  const ready = buildDetail({ status: "approved" });
  const headline = getCircuitBlockReuseHeadline(ready.summary);

  assert.equal(headline.state, "reusable");
  assert.equal(headline.stage, "reusable");
  assert.equal(headline.label, "Ready to reuse");
  assert.equal(headline.tone, "verified");
});

/**
 * Verifies the headline always reports the *worst* stage, so a later blocked stage wins.
 */
test("reuse headline always reports the worst stage", () => {
  const lifecycleBlocked = buildDetail({
    status: "approved",
    summaryOverrides: {
      approvedPartCount: 1,
      lifecycleRiskCount: 1,
      optionalPartCount: 0,
      readinessGapCount: 0,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  });
  const restrictedBlocked = buildDetail({ status: "restricted" });

  const lifecycle = getCircuitBlockReuseHeadline(lifecycleBlocked.summary);
  const restricted = getCircuitBlockReuseHeadline(restrictedBlocked.summary);

  assert.equal(lifecycle.state, "blocked");
  assert.equal(lifecycle.stage, "parts_ready");
  assert.equal(lifecycle.tone, "danger");
  assert.match(lifecycle.label, /blocked at parts ready/iu);

  assert.equal(restricted.state, "blocked");
  assert.equal(restricted.stage, "reusable");
  assert.match(restricted.label, /blocked at reusable/iu);
});

/**
 * Verifies deprecated blocks report their own "Reuse retired" headline so engineers do not
 * confuse them with ready, pending, or blocked candidates.
 */
test("reuse headline reports retired for deprecated blocks", () => {
  const headline = getCircuitBlockReuseHeadline(buildDetail({ status: "deprecated" }).summary);

  assert.equal(headline.state, "blocked");
  assert.equal(headline.stage, "defined");
});

/**
 * Verifies the readiness filter matches only the requested verdict bucket.
 */
test("matchesReuseReadinessFilter narrows by verdict", () => {
  const ready = getCircuitBlockReuseHeadline(buildDetail({ status: "approved" }).summary);
  const draft = getCircuitBlockReuseHeadline(buildDetail({ status: "draft" }).summary);
  const lifecycleBlocked = getCircuitBlockReuseHeadline(
    buildDetail({
      status: "approved",
      summaryOverrides: {
        approvedPartCount: 0,
        lifecycleRiskCount: 1,
        optionalPartCount: 0,
        readinessGapCount: 0,
        requiredPartCount: 1,
        strictSubstitutionCount: 0,
        totalPartCount: 1
      }
    }).summary
  );

  assert.equal(matchesReuseReadinessFilter(ready, null), true);
  assert.equal(matchesReuseReadinessFilter(ready, "reusable"), true);
  assert.equal(matchesReuseReadinessFilter(ready, "pending"), false);
  assert.equal(matchesReuseReadinessFilter(draft, "pending"), true);
  assert.equal(matchesReuseReadinessFilter(draft, "reusable"), false);
  assert.equal(matchesReuseReadinessFilter(lifecycleBlocked, "blocked"), true);
  assert.equal(matchesReuseReadinessFilter(lifecycleBlocked, "reusable"), false);
});

/**
 * Verifies the summary-shaped helper returns the same stage states as the detail-shaped one.
 */
test("readiness derived from summary matches the detail-shaped helper", () => {
  const detail = buildDetail({ status: "in_review" });
  const fromDetail = getCircuitBlockReuseReadiness(detail);
  const fromSummary = getCircuitBlockReuseReadinessFromSummary(detail.summary);

  assert.deepEqual(
    fromDetail.stages.map((stage) => stage.state),
    fromSummary.stages.map((stage) => stage.state)
  );
});

/**
 * Builds a circuit block detail fixture used by the reuse-readiness tests.
 */
function buildDetail(input: {
  status: CircuitBlockStatus;
  blockOverrides?: Partial<CircuitBlock>;
  summaryOverrides?: Partial<CircuitBlockSummary>;
}): CircuitBlockDetailResponse {
  const baseBlock: CircuitBlock = {
    blockKey: "TEST-BLOCK",
    blockType: "power",
    constraints: {},
    createdAt: "2026-05-01T12:00:00.000Z",
    description: "Reusable test block.",
    id: "cblock-test",
    name: "Test block",
    owner: "Hardware",
    reuseScope: "Test scope",
    status: input.status,
    updatedAt: "2026-05-01T12:00:00.000Z",
    ...input.blockOverrides
  };

  const baseSummary: CircuitBlockSummary = {
    activeBlockingRiskCount: 0,
    activeKnownRiskCount: 0,
    approvedPartCount: 1,
    circuitBlock: baseBlock,
    evidenceAttachmentCount: 0,
    lifecycleRiskCount: 0,
    optionalPartCount: 0,
    projectUsageCount: 0,
    readinessGapCount: 0,
    requiredPartCount: 1,
    strictSubstitutionCount: 0,
    totalPartCount: 1,
    ...input.summaryOverrides
  };

  return {
    boundary: "Test boundary copy.",
    circuitBlock: baseBlock,
    evidence: [],
    instantiations: [],
    knownRisks: [],
    parts: [],
    projectDependencies: [],
    state: "available",
    summary: baseSummary
  };
}
