/**
 * Day-zero overlap panel for the project detail page.
 *
 * Renders the top prior projects ranked by shared confirmed-usage parts, plus
 * informational counts of connector-class and circuit-block where-used hits in the
 * current project's confirmed usage.
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
import type { ProjectOverlapPanelResponse, ProjectOverlapPriorProject } from "@ee-library/shared/types";

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
          {" · "}
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
          never an approval signal — shared parts here do not imply that either project&apos;s assets are approved or verified for export.
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
                  <th scope="col">Shared parts (sample)</th>
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
      </div>
    </SectionPanel>
  );
}

function resolveSharedPartsPreview(row: ProjectOverlapPriorProject): Array<{ partId: string; mpn: string }> {
  if (row.sharedPartsPreview.length > 0) {
    return row.sharedPartsPreview;
  }
  return row.sharedPartIds.map((partId) => ({ partId, mpn: partId }));
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
          {previews.map(({ partId, mpn }) => (
            <li key={partId}>
              <Link className="project-overlap-panel__mpn-link" href={`/parts/${partId}`}>
                {mpn}
              </Link>
              <span className="muted-copy ui-mono project-overlap-panel__part-id">{partId}</span>
            </li>
          ))}
        </ul>
        {truncatedCount > 0 ? (
          <p className="muted-copy project-overlap-panel__truncated-note">
            and {truncatedCount} more shared part{truncatedCount === 1 ? "" : "s"} — open the prior project to browse full confirmed usage.
          </p>
        ) : null}
      </td>
    </tr>
  );
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
