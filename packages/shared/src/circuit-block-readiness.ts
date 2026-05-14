/**
 * File header: Pure reuse-readiness derivation for circuit blocks.
 *
 * The four explicit gates a reusable circuit pattern must pass:
 *   defined → roles_complete → parts_ready → reusable
 *
 * Each stage is kept distinct so the library, instantiation pickers, and the detail page all
 * reason about reuse using the *same* honest verdict. None of these gates approve linked parts,
 * unlock asset validation, or mark exports verified — that boundary is owned by part-level
 * trust and is intentionally never inferred from a block's reuse state.
 *
 * This module is presentation-free so it can be shared between the API (for library filters)
 * and the web app (for the detail strip and library scan badges) without dragging UI tone or
 * locale-specific copy into the engineering-memory core.
 */
import type {
  CircuitBlock,
  CircuitBlockReuseReadinessFilter,
  CircuitBlockStatus,
  CircuitBlockSummary
} from "./types";

/** CircuitBlockReuseStage names the four explicit gates a reusable circuit passes through. */
export type CircuitBlockReuseStage = "defined" | "roles_complete" | "parts_ready" | "reusable";

/** CircuitBlockReuseStageState keeps the per-stage outcome explicit and non-blurring. */
export type CircuitBlockReuseStageState = "passed" | "pending" | "blocked" | "not_applicable";

/**
 * CircuitBlockReuseStageVerdict carries the pure derivation for one stage.
 *
 * `code` is a stable machine-readable reason (e.g. `lifecycle_risk`, `optional_only_roles`)
 * so UIs can localise copy, swap labels, or attach tooltips without re-parsing the detail.
 */
export interface CircuitBlockReuseStageVerdict {
  stage: CircuitBlockReuseStage;
  state: CircuitBlockReuseStageState;
  code: string;
  /** Plain-English reason backing the verdict. Kept terse so it works in tooltips and table cells. */
  detail: string;
}

/**
 * CircuitBlockReuseHeadlineVerdict collapses the four-stage strip into one row-level verdict.
 *
 * The headline always reports the worst stage so the library never advertises a block as
 * "ready" when a later gate is blocked. A `not_applicable` reusable stage (deprecated blocks)
 * is surfaced as its own verdict so deprecated patterns are scannable but never mistaken for
 * ready. The headline is used both for the library "Reuse" badge and the readiness filter.
 */
export interface CircuitBlockReuseHeadlineVerdict {
  state: "reusable" | "pending" | "blocked" | "not_applicable";
  stage: CircuitBlockReuseStage;
  code: string;
  detail: string;
}

/**
 * Returns the four-stage reuse-readiness verdicts for one block and its summary.
 */
export function getCircuitBlockReuseStageVerdicts(
  circuitBlock: CircuitBlock,
  summary: CircuitBlockSummary
): CircuitBlockReuseStageVerdict[] {
  return [
    buildDefinedVerdict(circuitBlock),
    buildRolesCompleteVerdict(summary),
    buildPartsReadyVerdict(summary),
    buildReusableVerdict(circuitBlock.status, summary)
  ];
}

/**
 * Returns the single-row reuse-readiness verdict for one circuit-block summary.
 */
export function getCircuitBlockReuseHeadlineVerdict(summary: CircuitBlockSummary): CircuitBlockReuseHeadlineVerdict {
  const stages = getCircuitBlockReuseStageVerdicts(summary.circuitBlock, summary);

  const firstBlocked = stages.find((entry) => entry.state === "blocked");

  if (firstBlocked) {
    return {
      code: firstBlocked.code,
      detail: firstBlocked.detail,
      stage: firstBlocked.stage,
      state: "blocked"
    };
  }

  const notApplicable = stages.find((entry) => entry.state === "not_applicable");

  if (notApplicable) {
    return {
      code: notApplicable.code,
      detail: notApplicable.detail,
      stage: notApplicable.stage,
      state: "not_applicable"
    };
  }

  const firstPending = stages.find((entry) => entry.state === "pending");

  if (firstPending) {
    return {
      code: firstPending.code,
      detail: firstPending.detail,
      stage: firstPending.stage,
      state: "pending"
    };
  }

  const reusable = stages[stages.length - 1]!;

  return {
    code: reusable.code,
    detail: reusable.detail,
    stage: reusable.stage,
    state: "reusable"
  };
}

/**
 * Decides whether one headline verdict matches the requested library readiness filter.
 *
 * The library exposes a coarse "reusable / pending / blocked" filter; `not_applicable`
 * (deprecated) intentionally drops out of all three buckets so engineers do not see retired
 * patterns when looking for ready, pending, or blocked candidates. Callers that want to see
 * deprecated blocks must not apply this filter.
 */
export function matchesCircuitBlockReuseReadinessFilter(
  headline: CircuitBlockReuseHeadlineVerdict,
  filter: CircuitBlockReuseReadinessFilter | null
): boolean {
  if (!filter) return true;
  if (filter === "reusable") return headline.state === "reusable";
  if (filter === "pending") return headline.state === "pending";
  if (filter === "blocked") return headline.state === "blocked";
  return true;
}

function buildDefinedVerdict(circuitBlock: CircuitBlock): CircuitBlockReuseStageVerdict {
  const hasOwner = (circuitBlock.owner ?? "").trim().length > 0;
  const hasScope = circuitBlock.reuseScope.trim().length > 0;
  const hasDescription = circuitBlock.description.trim().length > 0;

  if (circuitBlock.status === "deprecated") {
    return {
      code: "deprecated",
      detail: "Block is deprecated. Engineering memory is preserved, but new reuse is not recommended.",
      stage: "defined",
      state: "blocked"
    };
  }

  if (!hasOwner && !hasScope && !hasDescription) {
    return {
      code: "identity_incomplete",
      detail: "No owner, reuse scope, or description recorded yet.",
      stage: "defined",
      state: "pending"
    };
  }

  return {
    code: "identity_recorded",
    detail: hasScope
      ? `Block identity recorded. Reuse scope: ${circuitBlock.reuseScope}.`
      : "Block identity recorded. Adding a reuse scope makes the constraints scannable.",
    stage: "defined",
    state: "passed"
  };
}

function buildRolesCompleteVerdict(summary: CircuitBlockSummary): CircuitBlockReuseStageVerdict {
  if (summary.totalPartCount === 0) {
    return {
      code: "no_roles",
      detail: "Add at least one required part role before reuse can be evaluated.",
      stage: "roles_complete",
      state: "pending"
    };
  }

  if (summary.requiredPartCount === 0) {
    return {
      code: "optional_only_roles",
      detail: `${summary.optionalPartCount} optional ${pluralize("role", summary.optionalPartCount)} recorded. No required roles make reuse evaluation incomplete.`,
      stage: "roles_complete",
      state: "pending"
    };
  }

  const detailParts: string[] = [`${summary.requiredPartCount} required`];
  if (summary.optionalPartCount > 0) detailParts.push(`${summary.optionalPartCount} optional`);
  if (summary.strictSubstitutionCount > 0) detailParts.push(`${summary.strictSubstitutionCount} strict-substitution`);

  return {
    code: "roles_recorded",
    detail: `Roles recorded: ${detailParts.join(", ")}.`,
    stage: "roles_complete",
    state: "passed"
  };
}

function buildPartsReadyVerdict(summary: CircuitBlockSummary): CircuitBlockReuseStageVerdict {
  if (summary.totalPartCount === 0) {
    return {
      code: "no_parts_to_evaluate",
      detail: "Linked-part readiness cannot be evaluated until at least one role is recorded.",
      stage: "parts_ready",
      state: "pending"
    };
  }

  if (summary.lifecycleRiskCount > 0) {
    return {
      code: "lifecycle_risk",
      detail: `${summary.lifecycleRiskCount} required ${pluralize("part", summary.lifecycleRiskCount)} marked obsolete or not-recommended. Reuse should not proceed until each is replaced or scoped.`,
      stage: "parts_ready",
      state: "blocked"
    };
  }

  if (summary.readinessGapCount > 0) {
    return {
      code: "readiness_gap",
      detail: `${summary.readinessGapCount} required ${pluralize("role", summary.readinessGapCount)} still has approval or readiness blockers on the linked part.`,
      stage: "parts_ready",
      state: "blocked"
    };
  }

  if (summary.requiredPartCount === 0) {
    return {
      code: "no_required_parts",
      detail: "Optional-only roles cannot confirm parts-ready. Add a required role to enable the gate.",
      stage: "parts_ready",
      state: "pending"
    };
  }

  return {
    code: "parts_approved",
    detail: `${summary.approvedPartCount} of ${summary.totalPartCount} ${pluralize("part", summary.totalPartCount)} approved with no readiness or lifecycle blockers.`,
    stage: "parts_ready",
    state: "passed"
  };
}

function buildReusableVerdict(status: CircuitBlockStatus, summary: CircuitBlockSummary): CircuitBlockReuseStageVerdict {
  if (summary.activeBlockingRiskCount > 0 && status !== "deprecated") {
    return {
      code: "unresolved_blocking_risk",
      detail: `${summary.activeBlockingRiskCount} unresolved ${summary.activeBlockingRiskCount === 1 ? "blocking risk" : "blocking risks"} on this block. Resolve or deprecate before reusing.`,
      stage: "reusable",
      state: "blocked"
    };
  }

  if (status === "approved") {
    return {
      code: "approved",
      detail: summary.activeKnownRiskCount > 0
        ? `Block is approved for reuse with ${summary.activeKnownRiskCount} open non-blocking ${summary.activeKnownRiskCount === 1 ? "risk note" : "risk notes"}. Linked-part approval and export readiness remain separate per part.`
        : "Block is approved for reuse. Linked-part approval and export readiness remain separate per part.",
      stage: "reusable",
      state: "passed"
    };
  }

  if (status === "in_review") {
    return {
      code: "in_review",
      detail: "Reuse approval review is open. Block reuse is decided separately from per-part approval.",
      stage: "reusable",
      state: "pending"
    };
  }

  if (status === "draft") {
    return {
      code: "draft",
      detail: "Block is still in draft. Reuse review has not been opened.",
      stage: "reusable",
      state: "pending"
    };
  }

  if (status === "restricted") {
    return {
      code: "restricted",
      detail: "Block reuse is restricted. Confirm reuse scope with the owner before instantiating.",
      stage: "reusable",
      state: "blocked"
    };
  }

  return {
    code: "deprecated",
    detail: "Block has been deprecated. New reuse is not recommended; engineering memory is preserved for prior projects.",
    stage: "reusable",
    state: "not_applicable"
  };
}

function pluralize(word: string, count: number, plural?: string): string {
  if (count === 1) return word;
  return plural ?? `${word}s`;
}
