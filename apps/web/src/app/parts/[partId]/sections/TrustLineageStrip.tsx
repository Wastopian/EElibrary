/**
 * File header: Four-stage trust lineage strip — imported / reviewed / approved / verified-for-export.
 */

import React from "react";
import { StatusBadge } from "@ee-library/ui";
import type { TrustLineageStageSummary, TrustLineageSummary } from "../../../../lib/trust-lineage";
import { mapViewToneToBadge } from "../lib/tone";

/**
 * Renders the four-stage trust lineage strip so engineers can scan
 * imported / reviewed / approved / verified-for-export at a glance.
 */
export function TrustLineageStrip({ summary }: { summary: TrustLineageSummary }): React.ReactElement {
  const guidance = summarizeTrustGuidance(summary);

  return (
    <section className="trust-lineage-strip" role="group" aria-label="Trust lineage">
      <div className="trust-lineage-strip__guidance">
        <strong>{guidance.title}</strong>
        <p>{guidance.detail}</p>
      </div>
      <details className="trust-lineage-strip__steps">
        <summary>Show verification steps</summary>
        <ol className="trust-lineage-strip__stages">
          {summary.stages.map((stage, index) => (
            <TrustLineageStageItem
              key={stage.stage}
              isLast={index === summary.stages.length - 1}
              stage={stage}
            />
          ))}
        </ol>
        <p className="trust-lineage-strip__boundary muted-copy">{summary.boundary}</p>
      </details>
    </section>
  );
}

/**
 * Summarizes which stage the part has reached so the strip has a one-line headline.
 */
function summarizeTrustGuidance(summary: TrustLineageSummary): { detail: string; title: string } {
  const stageByKey = new Map(summary.stages.map((stage) => [stage.stage, stage]));
  const verifiedStage = stageByKey.get("verified_for_export");
  const approvedStage = stageByKey.get("approved");
  const reviewedStage = stageByKey.get("reviewed");
  const importedStage = stageByKey.get("imported");
  const blockedStage = summary.stages.find((stage) => stage.state === "blocked");

  if (blockedStage) {
    return {
      detail: `Resolve "${blockedStage.label}" first. Then continue in order from left to right.`,
      title: "Blocked right now"
    };
  }

  if (verifiedStage?.state === "passed") {
    return {
      detail: "This part has a verified export path.",
      title: "Ready for export"
    };
  }

  if (approvedStage?.state === "passed") {
    return {
      detail: "Part approval is complete. File verification is the remaining step.",
      title: "Almost ready"
    };
  }

  if (reviewedStage?.state === "passed") {
    return {
      detail: "Review is complete. Approval is the next step.",
      title: "Needs part approval"
    };
  }

  if (importedStage?.state === "passed") {
    return {
      detail: "Import is complete. Review is the next step.",
      title: "Needs review"
    };
  }

  return {
    detail: "No trust steps are complete yet.",
    title: "Not started"
  };
}

/**
 * Renders one trust-lineage stage with state badge, label, and one-line reason.
 */
function TrustLineageStageItem({ stage, isLast }: { stage: TrustLineageStageSummary; isLast: boolean }): React.ReactElement {
  return (
    <li className="trust-lineage-strip__item" data-state={stage.state}>
      <div className="trust-lineage-strip__item-header">
        <StatusBadge label={stage.label} tone={mapViewToneToBadge(stage.tone)} />
        <span className={`trust-lineage-strip__state trust-lineage-strip__state--${stage.state}`}>
          {stage.badgeLabel}
        </span>
      </div>
      <p className="trust-lineage-strip__detail">{stage.detail}</p>
      {!isLast ? <span aria-hidden="true" className="trust-lineage-strip__connector">→</span> : null}
    </li>
  );
}
