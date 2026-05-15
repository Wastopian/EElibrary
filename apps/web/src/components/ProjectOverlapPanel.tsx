/**
 * Day-zero overlap panel for the project detail page.
 *
 * Renders the top prior projects ranked by shared confirmed-usage parts, plus the
 * bounded usage and circuit-role previews that make each overlap inspectable.
 *
 * Honesty rules baked into copy:
 *  - Overlap is a *reuse signal*, never a trust signal. Two projects sharing 12
 *    confirmed parts does not mean either project's assets are approved or verified
 *    for export, and the panel never implies otherwise.
 *  - Empty states are explicit. No confirmed usage in the current project, no prior
 *    overlap, or no connector/circuit-block hits each render their own copy so a
 *    blank panel is never mistaken for a missing feature.
 *  - Counts are honest: `sharedPartCount` is the full overlap; `sharedPartIds` is a
 *    bounded preview list, and the panel renders an explicit "and N more shared parts"
 *    affordance when the preview was truncated.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionPanel, StatusBadge } from "@ee-library/ui";
import type {
  CircuitBlockPartSubstitutionPolicy,
  CircuitBlockStatus,
  ProjectOverlapCircuitBlockRolePreview,
  ProjectOverlapPanelResponse,
  ProjectOverlapPriorProject,
  ProjectOverlapSharedPartPreview,
  ProjectPartUsageStatus
} from "@ee-library/shared/types";

type ProjectOverlapPanelProps = {
  overlap: ProjectOverlapPanelResponse | null;
};

export function ProjectOverlapPanel({ overlap }: ProjectOverlapPanelProps) {
  if (!overlap) {
    return (
      <SectionPanel>
        <EmptyState
          body="No overlap data was returned for this project. This usually means the API is unreachable or the project memory store is not yet configured."
          title="Overlap unavailable"
        />
      </SectionPanel>
    );
  }

  if (overlap.scannedPartCount === 0) {
    return (
      <SectionPanel>
        <EmptyState
          body="No confirmed part usage has been recorded for this project yet. Once a parts list is uploaded and rows are matched, this panel will rank prior projects by shared confirmed parts."
          title="No confirmed usage to compare yet"
        />
        <p className="muted-copy project-overlap-panel__recover-hint">
          <Link href="#project-bom-upload-heading">Upload a parts list</Link>
          {" | "}
          <Link href="#advanced-project-tools">Match rows under Advanced project tools</Link>
        </p>
      </SectionPanel>
    );
  }

  return (
    <SectionPanel>
      <div className="project-overlap-panel">
        <p className="muted-copy project-overlap-panel__inline-copy">
          Prior projects ranked by how many of the same confirmed parts they share with this BOM. Overlap is a reuse signal,
          never an approval signal; shared parts here do not imply that either project&apos;s assets are approved or verified for export.
        </p>

        <div className="project-overlap-panel__stats">
          <ProjectOverlapStat
            label="Confirmed parts in this BOM"
            tone="info"
            value={overlap.scannedPartCount.toString()}
          />
          <ProjectOverlapStat
            label="Connectors with prior reuse"
            tone={overlap.connectorWhereUsedHitCount > 0 ? "verified" : "neutral"}
            value={overlap.connectorWhereUsedHitCount.toString()}
          />
          <ProjectOverlapStat
            label="Circuit-block role hits"
            tone={overlap.circuitBlockWhereUsedHitCount > 0 ? "verified" : "neutral"}
            value={overlap.circuitBlockWhereUsedHitCount.toString()}
          />
        </div>

        {overlap.priorProjects.length === 0 ? (
          <EmptyState
            body="No prior project shares any confirmed-usage parts with the current BOM yet. As more projects record confirmed usage, this list will populate."
            title="No prior projects share parts with this BOM yet"
          />
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table project-overlap-panel__table">
              <thead>
                <tr>
                  <th scope="col">Prior project</th>
                  <th scope="col">Shared parts</th>
                  <th scope="col">Usage clues</th>
                </tr>
              </thead>
              <tbody>
                {overlap.priorProjects.map((row) => (
                  <OverlapPriorProjectRow key={row.project.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <CircuitBlockRolePreviewList overlap={overlap} />
      </div>
    </SectionPanel>
  );
}

function resolveSharedPartsPreview(row: ProjectOverlapPriorProject): ProjectOverlapSharedPartPreview[] {
  if (row.sharedPartsPreview.length > 0) {
    return row.sharedPartsPreview;
  }
  return row.sharedPartIds.map((partId) => ({
    designatorsPreview: [],
    mpn: partId,
    partId,
    projectRevisionLabel: null,
    quantityTotal: null,
    usageCount: 0,
    usageStatus: null
  }));
}

function OverlapPriorProjectRow({ row }: { row: ProjectOverlapPriorProject }): React.ReactElement {
  const previews = resolveSharedPartsPreview(row);
  const truncatedCount = Math.max(0, row.sharedPartCount - previews.length);

  return (
    <tr>
      <th scope="row">
        <Link href={`/projects/${row.project.id}`}>{row.project.name}</Link>
        <p className="muted-copy ui-mono">{row.project.projectKey}</p>
      </th>
      <td>
        <StatusBadge label={`${row.sharedPartCount} shared`} tone={row.sharedPartCount > 0 ? "verified" : "neutral"} />
      </td>
      <td>
        <ul className="project-overlap-panel__shared-list">
          {previews.map((preview) => (
            <li key={preview.partId}>
              <div className="project-overlap-panel__shared-part-main">
                <Link className="project-overlap-panel__mpn-link" href={`/parts/${preview.partId}`}>
                  {preview.mpn}
                </Link>
                <span className="muted-copy project-overlap-panel__usage-clue">
                  {formatSharedUsageMeta(preview)}
                </span>
              </div>
              <span className="muted-copy ui-mono project-overlap-panel__part-id">{preview.partId}</span>
            </li>
          ))}
        </ul>
        {truncatedCount > 0 ? (
          <p className="muted-copy project-overlap-panel__truncated-note">
            and {truncatedCount} more shared part{truncatedCount === 1 ? "" : "s"} - open the prior project to browse full confirmed usage.
          </p>
        ) : null}
        <p className="muted-copy project-overlap-panel__usage-link">
          <Link href={`/projects/${row.project.id}#project-usage-heading`}>Open usage rows for {row.project.projectKey}</Link>
        </p>
      </td>
    </tr>
  );
}

/**
 * Renders circuit-block role previews for the confirmed parts in this BOM.
 */
function CircuitBlockRolePreviewList({ overlap }: { overlap: ProjectOverlapPanelResponse }): React.ReactElement | null {
  const previews = overlap.circuitBlockRoleHitsPreview ?? [];

  if (previews.length === 0) {
    return null;
  }

  const truncatedCount = Math.max(0, overlap.circuitBlockWhereUsedHitCount - previews.length);

  return (
    <div className="project-overlap-panel__role-preview">
      <div className="project-overlap-panel__role-preview-heading">
        <strong>Circuit-block role hits</strong>
        <p className="muted-copy">Reusable block roles that already depend on confirmed parts in this BOM.</p>
      </div>
      <ul className="project-overlap-panel__role-list">
        {previews.map((preview) => (
          <CircuitBlockRolePreviewItem key={preview.blockPartId} preview={preview} />
        ))}
      </ul>
      {truncatedCount > 0 ? (
        <p className="muted-copy project-overlap-panel__truncated-note">
          and {truncatedCount} more circuit-block role hit{truncatedCount === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders one circuit-block role hit with links to the block and part.
 */
function CircuitBlockRolePreviewItem({ preview }: { preview: ProjectOverlapCircuitBlockRolePreview }): React.ReactElement {
  return (
    <li>
      <div className="project-overlap-panel__role-main">
        <Link href={`/circuit-blocks/${preview.circuitBlockId}`}>{preview.blockName}</Link>
        <span className="muted-copy ui-mono">{preview.blockKey}</span>
      </div>
      <div className="project-overlap-panel__role-meta">
        <span>{preview.role}</span>
        <span>{preview.isRequired ? "Required" : "Optional"}</span>
        <span>{formatQuantityLabel(preview.quantity)}</span>
        <span>{formatCircuitBlockStatus(preview.blockStatus)}</span>
        <span>{formatSubstitutionPolicy(preview.substitutionPolicy)}</span>
      </div>
      <p className="muted-copy project-overlap-panel__role-part">
        Uses <Link href={`/parts/${preview.partId}`}>{preview.mpn}</Link>
        <span className="ui-mono"> {preview.partId}</span>
      </p>
    </li>
  );
}

/**
 * Formats the compact prior-project usage clues shown beside each shared MPN.
 */
function formatSharedUsageMeta(preview: ProjectOverlapSharedPartPreview): string {
  const clues: string[] = [];

  if (preview.projectRevisionLabel) {
    clues.push(`Rev ${preview.projectRevisionLabel}`);
  }
  if (preview.designatorsPreview.length > 0) {
    clues.push(preview.designatorsPreview.join(", "));
  }
  if (preview.quantityTotal !== null) {
    clues.push(formatQuantityLabel(preview.quantityTotal));
  }
  if (preview.usageStatus) {
    clues.push(formatUsageStatus(preview.usageStatus));
  }
  if (preview.usageCount > 1) {
    clues.push(`${preview.usageCount} usage rows`);
  }

  return clues.length > 0 ? clues.join(" | ") : "Confirmed usage row";
}

/** Formats nullable usage quantities without inventing missing quantity data. */
function formatQuantityLabel(quantity: number | null): string {
  return quantity === null ? "qty not recorded" : `qty ${Number.isInteger(quantity) ? quantity.toString() : quantity.toFixed(2)}`;
}

/** Formats project usage status labels for compact metadata rows. */
function formatUsageStatus(status: ProjectPartUsageStatus): string {
  return status.replace(/_/gu, " ");
}

/** Formats circuit-block status labels for compact metadata rows. */
function formatCircuitBlockStatus(status: CircuitBlockStatus): string {
  return status.replace(/_/gu, " ");
}

/** Formats substitution policy labels without exposing raw enum naming. */
function formatSubstitutionPolicy(policy: CircuitBlockPartSubstitutionPolicy): string {
  return policy.replace(/_/gu, " ");
}

/**
 * Renders one numeric stat tile for the overlap panel header.
 */
function ProjectOverlapStat({
  label,
  tone,
  value
}: {
  label: string;
  tone: "neutral" | "info" | "verified";
  value: string;
}) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
