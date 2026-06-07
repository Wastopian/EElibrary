/**
 * File header: Right-rail summary of blockers, risk flags, and review/export truth.
 */

import { StatusBadge } from "@ee-library/ui";
import type { BundleReadinessState } from "@ee-library/shared/types";
import React from "react";
import type { PartNextAction, getReviewWorkflowSummary } from "../../../../lib/detail-view-model";
import { approvalStatusTone, bundleReadinessTone, mapViewToneToBadge } from "../lib/tone";
import type { PartDetailPageRecord } from "../lib/types";

/**
 * Renders the right-rail style summary for blockers, risk flags, and review/export truth.
 */
export function DetailActionRail({
  approval,
  bundleReadiness,
  issues,
  nextActions,
  riskFlags,
  reviewWorkflowSummary,
}: {
  approval: PartDetailPageRecord["approval"];
  bundleReadiness: { label: string; reason: string; state: BundleReadinessState };
  issues: PartDetailPageRecord["issues"];
  nextActions: PartNextAction[];
  riskFlags: PartDetailPageRecord["riskFlags"];
  reviewWorkflowSummary: ReturnType<typeof getReviewWorkflowSummary>;
}) {
  return (
    <aside className="detail-action-rail" aria-label="Readiness blockers and next actions">
      <div className="detail-action-rail__card">
        <span>Next action</span>
        {nextActions.length > 0 ? (
          <ul>
            {nextActions.slice(0, 4).map((action) => (
              <li key={action.id}>
                <strong>{action.priority}</strong>
                <p>{action.label}</p>
                <p>{action.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No next action is currently derived for this record.</p>
        )}
      </div>

      <div className="detail-action-rail__card">
        <span>Top blockers</span>
        {issues.length > 0 ? (
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>
                <strong>{issue.severity}</strong>
                <p>{issue.summary}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No part-level blockers are currently recorded.</p>
        )}
      </div>

      <div className="detail-action-rail__card">
        <span>Risk flags</span>
        {riskFlags.length > 0 ? (
          <ul>
            {riskFlags.map((flag) => (
              <li key={flag.id}>
                <strong className={`detail-risk-flag detail-risk-flag--${flag.tone}`}>{flag.label}</strong>
                <p>{flag.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No part-level risk flags are currently recorded.</p>
        )}
      </div>

      <div className="detail-action-rail__card">
        <span>Review and export state</span>
        <div className="detail-action-rail__badges">
          <StatusBadge label={approval.summary} tone={approvalStatusTone(approval.status)} />
          <StatusBadge label={reviewWorkflowSummary.label} tone={mapViewToneToBadge(reviewWorkflowSummary.tone)} />
          <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
        </div>
        <p>{approval.detail}</p>
        <p>{bundleReadiness.reason}</p>
        <div className="detail-action-rail__links">
          <a href="#files-heading">Inspect assets</a>
          <a href="#approval-heading">Review export blockers</a>
        </div>
      </div>
    </aside>
  );
}
