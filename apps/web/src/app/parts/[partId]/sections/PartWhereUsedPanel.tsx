/**
 * File header: Confirmed project usage + circuit-block dependencies for one part.
 *
 * The panel keeps both signals visibly distinct: project usages are concrete BOM
 * history, circuit-block dependencies are reusable-design memory. Neither row count
 * implies the part is approved, validated, or export-ready.
 */

import React from "react";
import Link from "next/link";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import type { PartCircuitBlockDependencyRecord } from "@ee-library/shared/types";
import {
  getCircuitBlockReuseHeadline,
  type CircuitBlockReuseHeadline
} from "../../../../lib/circuit-block-reuse-readiness";
import {
  formatDateTime,
  formatDesignators,
  formatQuantity,
  formatRevisionLabel,
  formatUsageStatus
} from "../lib/format";
import { usageStatusTone } from "../lib/tone";
import type { PartWhereUsedState } from "../lib/types";

/**
 * Renders confirmed project usage history and circuit-block dependencies without
 * feeding either signal into approval or export labels.
 */
export function PartWhereUsedPanel({ state }: { state: PartWhereUsedState }) {
  if (state.status === "unavailable") {
    return (
      <EmptyState
        body={`Where-used history needs projects to be available. ${state.message}`}
        title="Where-used unavailable"
      />
    );
  }

  if (state.status === "not_found") {
    return (
      <EmptyState
        body="This part has no project-memory entry yet, so where-used history is empty."
        title="No where-used history"
      />
    );
  }

  const { usages, circuitBlockDependencies } = state.response;

  if (usages.length === 0 && circuitBlockDependencies.length === 0) {
    return (
      <EmptyState
        body="No confirmed project uses and no circuit-block references for this part yet. Weak, ambiguous, and unmatched BOM rows are intentionally excluded."
        title="No confirmed project usage"
      />
    );
  }

  return (
    <div className="where-used-panel">
      <p className="where-used-panel__boundary">
        <strong>Usage history only.</strong> Showing this part in projects or circuit blocks does not approve it or make it ready to export.
      </p>

      <section aria-labelledby="part-where-used-projects-heading" className="where-used-panel__section">
        <header className="where-used-panel__section-heading">
          <h3 id="part-where-used-projects-heading">Projects</h3>
          <p className="muted-copy">
            {usages.length > 0
              ? `Used in ${usages.length} ${usages.length === 1 ? "confirmed project row" : "confirmed project rows"}.`
              : "No confirmed project usage. Weak, ambiguous, and unmatched BOM rows are excluded."}
          </p>
        </header>
        {usages.length === 0
          ? <EmptyState title="No confirmed project usage" body="Once a BOM row matches this part and is confirmed, it will appear here." />
          : (
            <div className="where-used-table-wrap">
              <table className="where-used-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Revision</th>
                    <th>Usage status</th>
                    <th>Designators</th>
                    <th>Qty</th>
                    <th>Context</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {usages.map(({ bomLine, project, projectRevision, usage }) => (
                    <tr key={usage.id}>
                      <td>
                        <Link href={`/projects/${project.id}`}>{project.name}</Link>
                        <p className="ui-mono">{project.projectKey}</p>
                      </td>
                      <td>
                        <span>{formatRevisionLabel(projectRevision.revisionLabel)}</span>
                        <p>{projectRevision.revisionStatus}</p>
                      </td>
                      <td>
                        <StatusBadge label={formatUsageStatus(usage.usageStatus)} tone={usageStatusTone(usage.usageStatus)} />
                      </td>
                      <td className="ui-mono">{formatDesignators(usage.designators)}</td>
                      <td>{formatQuantity(usage.quantity)}</td>
                      <td>
                        <span>{usage.usageContext ?? bomLine?.rawDescription ?? "No usage notes recorded"}</span>
                        {bomLine ? <p className="ui-mono">BOM row {bomLine.rowNumber}</p> : <p>No BOM row linked</p>}
                      </td>
                      <td>{formatDateTime(usage.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section aria-labelledby="part-where-used-blocks-heading" className="where-used-panel__section">
        <header className="where-used-panel__section-heading">
          <h3 id="part-where-used-blocks-heading">Circuit blocks</h3>
          <p className="muted-copy">
            {circuitBlockDependencies.length > 0
              ? `Linked to ${circuitBlockDependencies.length} reusable ${circuitBlockDependencies.length === 1 ? "block" : "blocks"}. Reuse status here matches the block detail page and does not approve this part.`
              : "No reusable block references this part yet. Saving a working circuit as a reusable block is how engineering memory grows."}
          </p>
        </header>
        {circuitBlockDependencies.length === 0
          ? <EmptyState title="No circuit block dependencies" body="When this part fills a role in a reusable circuit block, that block will appear here with its reuse status." />
          : <PartCircuitBlockDependencyTable dependencies={circuitBlockDependencies} />}
      </section>
    </div>
  );
}

/**
 * Renders the per-block dependency rows showing which roles this part fills inside each
 * reusable circuit block, alongside the block's reuse-readiness headline.
 */
function PartCircuitBlockDependencyTable({ dependencies }: { dependencies: PartCircuitBlockDependencyRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Block</th>
            <th>Status</th>
            <th>Reuse</th>
            <th>Roles for this part</th>
            <th>Required roles</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {dependencies.map(({ summary, blockParts }) => {
            const headline: CircuitBlockReuseHeadline = getCircuitBlockReuseHeadline(summary);
            return (
              <tr key={summary.circuitBlock.id}>
                <td>
                  <Link href={`/circuit-blocks/${encodeURIComponent(summary.circuitBlock.id)}`}>
                    {summary.circuitBlock.name}
                  </Link>
                  <p className="ui-mono">{summary.circuitBlock.blockKey}</p>
                  <p className="muted-copy">{summary.circuitBlock.reuseScope || summary.circuitBlock.description}</p>
                </td>
                <td>
                  <StatusBadge
                    label={formatCircuitBlockStatusLabel(summary.circuitBlock.status)}
                    tone={circuitBlockStatusToneForWhereUsed(summary.circuitBlock.status)}
                  />
                </td>
                <td>
                  <StatusBadge label={headline.label} tone={headlineToneToBadgeForWhereUsed(headline.tone)} />
                  <p className="muted-copy">{headline.detail}</p>
                </td>
                <td>
                  <ul className="where-used-role-list">
                    {blockParts.map((blockPart) => (
                      <li key={blockPart.id}>
                        <span className="ui-mono">{blockPart.role}</span>
                        {" "}
                        <StatusBadge label={blockPart.isRequired ? "Required" : "Optional"} tone={blockPart.isRequired ? "review" : "neutral"} />
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{summary.requiredPartCount}</td>
                <td>{formatDateTime(summary.circuitBlock.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Formats `CircuitBlockStatus` enum values for the part-detail circuit-block dependency table.
 */
function formatCircuitBlockStatusLabel(status: PartCircuitBlockDependencyRecord["summary"]["circuitBlock"]["status"]): string {
  return {
    approved: "Approved",
    deprecated: "Deprecated",
    draft: "Draft",
    in_review: "In review",
    restricted: "Restricted"
  }[status];
}

/**
 * Maps `CircuitBlockStatus` to a badge tone for the part-detail where-used table.
 */
function circuitBlockStatusToneForWhereUsed(status: PartCircuitBlockDependencyRecord["summary"]["circuitBlock"]["status"]): BadgeTone {
  if (status === "approved") return "verified";
  if (status === "in_review" || status === "restricted") return "review";
  if (status === "deprecated") return "neutral";
  return "info";
}

/**
 * Maps the reuse-headline `ViewTone` onto a `BadgeTone` accepted by StatusBadge.
 */
function headlineToneToBadgeForWhereUsed(tone: CircuitBlockReuseHeadline["tone"]): BadgeTone {
  if (tone === "generated") return "info";
  return tone;
}
