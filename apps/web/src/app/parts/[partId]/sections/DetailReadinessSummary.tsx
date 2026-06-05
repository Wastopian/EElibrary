/**
 * File header: Renders the explanation-first readiness record summary using existing view-model signals.
 */

import React from "react";
import { StatusBadge } from "@ee-library/ui";
import {
  getAssetTruthSummary,
  getConnectorWorkflowSummary,
  getQuickReadinessSummary,
  getRecoveryWorkflowSummary,
  getReviewWorkflowSummary
} from "../../../../lib/detail-view-model";
import { approvalStatusTone, mapViewToneToBadge, readinessStatusTone } from "../lib/tone";
import type { PartDetailPageRecord } from "../lib/types";

/**
 * Renders the explanation-first readiness record summary using existing view-model signals.
 */
export function DetailReadinessSummary({
  approval,
  assetTruthSummary,
  connectorOrRecoverySummary,
  quickReadinessSummary,
  readinessSummary,
  reviewWorkflowSummary
}: {
  approval: PartDetailPageRecord["approval"];
  assetTruthSummary: ReturnType<typeof getAssetTruthSummary>;
  connectorOrRecoverySummary: NonNullable<ReturnType<typeof getConnectorWorkflowSummary>> | ReturnType<typeof getRecoveryWorkflowSummary>;
  quickReadinessSummary: ReturnType<typeof getQuickReadinessSummary>;
  readinessSummary: PartDetailPageRecord["readinessSummary"];
  reviewWorkflowSummary: ReturnType<typeof getReviewWorkflowSummary>;
}) {
  return (
    <section aria-label="Readiness summary" className={`detail-readiness-summary detail-readiness-summary--${quickReadinessSummary.tone}`}>
      <div className="detail-readiness-summary__lead">
        <div>
          <p className="app-kicker">Readiness record</p>
          <h2>{readinessSummary.label}</h2>
          <p className="detail-readiness-summary__subhead">{approval.summary}</p>
          <p>{readinessSummary.detail}</p>
        </div>
        <div className="detail-readiness-summary__badges">
          <StatusBadge label={readinessSummary.label} tone={readinessStatusTone(readinessSummary.status)} />
          <StatusBadge label={approval.summary} tone={approvalStatusTone(approval.status)} />
          <StatusBadge label={assetTruthSummary.label} tone={mapViewToneToBadge(assetTruthSummary.tone)} />
          <StatusBadge label={connectorOrRecoverySummary.label} tone={mapViewToneToBadge(connectorOrRecoverySummary.tone)} />
          <StatusBadge label={reviewWorkflowSummary.label} tone={mapViewToneToBadge(reviewWorkflowSummary.tone)} />
        </div>
      </div>

      <div className="detail-readiness-summary__grid">
        <div>
          <span>Blockers and next actions</span>
          {readinessSummary.recommendedActions.length > 0 ? (
            <ul>
              {readinessSummary.recommendedActions.map((action, index) => (
                <li key={action}>
                  <strong>{index === 0 && readinessSummary.status === "blocked" ? "high" : index <= 1 ? "medium" : "low"}</strong>
                  {action}
                </li>
              ))}
            </ul>
          ) : (
            <p>No readiness actions are currently recorded for this part.</p>
          )}
        </div>
        <div>
          <span>Approval</span>
          <p>{approval.detail}</p>
          <p>Whole-part approval remains separate from generated asset review and explicit export promotion.</p>
        </div>
        <div>
          <span>File status</span>
          <p>{quickReadinessSummary.detail}</p>
        </div>
      </div>
    </section>
  );
}
