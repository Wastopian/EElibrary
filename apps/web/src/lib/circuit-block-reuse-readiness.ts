/**
 * File header: Builds the four-stage reuse-readiness strip for the circuit block detail page
 * and the compact reuse headline used by library scan rows and instantiation pickers.
 *
 * The pure derivation lives in `@ee-library/shared/circuit-block-readiness`, so the API,
 * library filter, detail-page strip, and headline badge all reason about reuse using the
 * exact same verdict. This module layers presentation-only concerns on top: UI tone, the
 * stage's display label (in the detail page), and the boundary copy that keeps reuse
 * intentionally separate from part-level approval, asset validation, and export gates.
 *
 * Block status is never inherited by linked parts. Parts being approved does not approve
 * the block. And approving the block does not unlock part export.
 */

import {
  getCircuitBlockReuseHeadlineVerdict,
  getCircuitBlockReuseStageVerdicts,
  matchesCircuitBlockReuseReadinessFilter
} from "@ee-library/shared/circuit-block-readiness";
import type {
  CircuitBlockDetailResponse,
  CircuitBlockReuseReadinessFilter,
  CircuitBlockSummary
} from "@ee-library/shared/types";
import type {
  CircuitBlockReuseHeadlineVerdict,
  CircuitBlockReuseStage,
  CircuitBlockReuseStageState,
  CircuitBlockReuseStageVerdict
} from "@ee-library/shared/circuit-block-readiness";
import type { ViewTone } from "./detail-view-model";

export type { CircuitBlockReuseStage, CircuitBlockReuseStageState } from "@ee-library/shared/circuit-block-readiness";

/** CircuitBlockReuseStageSummary describes one scannable stage in the reuse-readiness strip. */
export interface CircuitBlockReuseStageSummary {
  stage: CircuitBlockReuseStage;
  label: string;
  state: CircuitBlockReuseStageState;
  /** Short label suitable for a status badge (eg "Approved", "Parts ready"). */
  badgeLabel: string;
  /** One-line plain-English reason (eg "No required part roles yet"). */
  detail: string;
  /** Tone aligned with the rest of the detail page. */
  tone: ViewTone;
}

/** CircuitBlockReuseReadinessSummary bundles all four stages with the explicit boundary copy. */
export interface CircuitBlockReuseReadinessSummary {
  stages: CircuitBlockReuseStageSummary[];
  /** Boundary reminder so the strip never blurs block-level reuse with part-level approval or export. */
  boundary: string;
}

/** CircuitBlockReuseHeadline is the row-level verdict with a UI tone, used in scan surfaces. */
export interface CircuitBlockReuseHeadline {
  state: CircuitBlockReuseHeadlineVerdict["state"];
  stage: CircuitBlockReuseStage;
  /** Short scan-friendly label (eg "Ready to reuse", "Blocked: lifecycle"). */
  label: string;
  /** One-line plain-English reason backing the verdict. */
  detail: string;
  /** UI tone aligned with the rest of the detail page. */
  tone: ViewTone;
}

const BOUNDARY_COPY =
  "Block reuse is separate from part approval, asset validation, and export readiness. None of the earlier gates imply the next.";

/**
 * Builds the four-stage reuse-readiness strip for one circuit block detail response.
 */
export function getCircuitBlockReuseReadiness(detail: CircuitBlockDetailResponse): CircuitBlockReuseReadinessSummary {
  return buildReuseReadinessFromSummary(detail.summary);
}

/**
 * Builds the four-stage strip from one library `CircuitBlockSummary`.
 *
 * Library views can derive the same verdict without doing a per-row detail fetch.
 */
export function getCircuitBlockReuseReadinessFromSummary(summary: CircuitBlockSummary): CircuitBlockReuseReadinessSummary {
  return buildReuseReadinessFromSummary(summary);
}

/**
 * Returns the single-row reuse-readiness verdict with a UI tone for scan surfaces.
 */
export function getCircuitBlockReuseHeadline(summary: CircuitBlockSummary): CircuitBlockReuseHeadline {
  const verdict = getCircuitBlockReuseHeadlineVerdict(summary);
  const stageLabel = stageDisplayLabel(verdict.stage);

  if (verdict.state === "blocked") {
    return {
      detail: verdict.detail,
      label: `Blocked at ${stageLabel.toLowerCase()}`,
      stage: verdict.stage,
      state: verdict.state,
      tone: stageDangerOrReview(verdict.code)
    };
  }

  if (verdict.state === "not_applicable") {
    return {
      detail: verdict.detail,
      label: "Reuse retired",
      stage: verdict.stage,
      state: verdict.state,
      tone: "neutral"
    };
  }

  if (verdict.state === "pending") {
    return {
      detail: verdict.detail,
      label: `Pending at ${stageLabel.toLowerCase()}`,
      stage: verdict.stage,
      state: verdict.state,
      tone: pendingTone(verdict.code)
    };
  }

  return {
    detail: verdict.detail,
    label: "Ready to reuse",
    stage: verdict.stage,
    state: verdict.state,
    tone: "verified"
  };
}

/** Re-exports the shared filter so the library page can hand it to the headline matcher. */
export function matchesReuseReadinessFilter(
  headline: CircuitBlockReuseHeadline,
  filter: CircuitBlockReuseReadinessFilter | null
): boolean {
  return matchesCircuitBlockReuseReadinessFilter(
    {
      code: headline.label,
      detail: headline.detail,
      stage: headline.stage,
      state: headline.state
    },
    filter
  );
}

/**
 * Internal helper: maps the shared four-stage verdicts to UI-friendly stage summaries.
 */
function buildReuseReadinessFromSummary(summary: CircuitBlockSummary): CircuitBlockReuseReadinessSummary {
  const stages = getCircuitBlockReuseStageVerdicts(summary.circuitBlock, summary).map(decorateStageVerdict);

  return {
    boundary: BOUNDARY_COPY,
    stages
  };
}

function decorateStageVerdict(verdict: CircuitBlockReuseStageVerdict): CircuitBlockReuseStageSummary {
  return {
    badgeLabel: stageBadgeLabel(verdict),
    detail: verdict.detail,
    label: stageDisplayLabel(verdict.stage),
    stage: verdict.stage,
    state: verdict.state,
    tone: stageVerdictTone(verdict)
  };
}

function stageDisplayLabel(stage: CircuitBlockReuseStage): string {
  switch (stage) {
    case "defined":
      return "Defined";
    case "roles_complete":
      return "Roles complete";
    case "parts_ready":
      return "Parts ready";
    case "reusable":
      return "Reusable";
    default:
      return stage;
  }
}

function stageBadgeLabel(verdict: CircuitBlockReuseStageVerdict): string {
  switch (verdict.code) {
    case "deprecated":
      return "Deprecated";
    case "identity_incomplete":
      return "Identity incomplete";
    case "identity_recorded":
      return "Identity recorded";
    case "no_roles":
      return "No part roles";
    case "optional_only_roles":
      return "Optional roles only";
    case "roles_recorded":
      return "Roles recorded";
    case "no_parts_to_evaluate":
      return "No parts to evaluate";
    case "lifecycle_risk":
      return "Lifecycle risk";
    case "readiness_gap":
      return "Readiness gap";
    case "no_required_parts":
      return "No required parts";
    case "parts_approved":
      return "Parts approved";
    case "approved":
      return "Approved for reuse";
    case "in_review":
      return "In review";
    case "draft":
      return "Draft";
    case "restricted":
      return "Restricted";
    default:
      return verdict.state;
  }
}

function stageVerdictTone(verdict: CircuitBlockReuseStageVerdict): ViewTone {
  if (verdict.state === "passed") {
    return verdict.stage === "parts_ready" || verdict.stage === "reusable" ? "verified" : "info";
  }

  if (verdict.state === "blocked") {
    return verdict.code === "lifecycle_risk" ? "danger" : "review";
  }

  if (verdict.state === "pending") {
    return pendingTone(verdict.code);
  }

  return "neutral";
}

function pendingTone(code: string): ViewTone {
  switch (code) {
    case "in_review":
    case "optional_only_roles":
      return "review";
    default:
      return "neutral";
  }
}

function stageDangerOrReview(code: string): ViewTone {
  return code === "lifecycle_risk" ? "danger" : "review";
}
