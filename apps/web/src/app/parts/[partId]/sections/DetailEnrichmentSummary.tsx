/**
 * File header: Renders the background enrichment summary without turning queued or
 * succeeded work into approval or export truth.
 */

import { StatusBadge } from "@ee-library/ui";
import React from "react";
import type { DetailEnrichmentStatusItem, getPartEnrichmentStateLabel } from "../../../../lib/detail-view-model";
import { formatDateTime } from "../lib/format";
import { enrichmentJobStatusTone, mapViewToneToBadge } from "../lib/tone";
import type { PartDetailPageDetail } from "../lib/types";

/**
 * Renders the background enrichment summary without turning queued or succeeded work into approval or export truth.
 */
export function DetailEnrichmentSummary({
  boundaryCopy,
  items,
  summary,
  summarySignal
}: {
  boundaryCopy: string | null;
  items: DetailEnrichmentStatusItem[];
  summary: PartDetailPageDetail["enrichmentSummary"];
  summarySignal: ReturnType<typeof getPartEnrichmentStateLabel>;
}) {
  return (
    <div className="detail-acquisition-summary">
      <div className="detail-acquisition-summary__lead">
        <div>
          <p className="app-kicker">Background enrichment</p>
          <h3>{summarySignal.label}</h3>
          <p>{summarySignal.detail}</p>
        </div>
        <div className="detail-acquisition-summary__badges">
          <StatusBadge label={summarySignal.label} tone={mapViewToneToBadge(summarySignal.tone)} />
          {summary.latestJobStatus ? <StatusBadge label={`Latest ${summary.latestJobStatus}`} tone={enrichmentJobStatusTone(summary.latestJobStatus)} /> : null}
          {summary.activeJobCount > 0 ? <StatusBadge label={`${summary.activeJobCount} active`} tone="info" /> : null}
        </div>
      </div>

      {boundaryCopy ? (
        <p className="detail-acquisition-summary__boundary">
          <strong>{boundaryCopy}</strong> The completeness checklist below still reflects only currently stored review, asset, and export truth.
        </p>
      ) : null}

      <dl className="detail-acquisition-grid">
        <div>
          <dt>Latest job status</dt>
          <dd>{summary.latestJobStatus ?? "No jobs recorded"}</dd>
        </div>
        <div>
          <dt>Active jobs</dt>
          <dd>{summary.activeJobCount}</dd>
        </div>
        <div className="detail-acquisition-grid__wide">
          <dt>Enrichment note</dt>
          <dd>{summary.reason ?? "Background enrichment can improve source evidence, but it does not imply parsing, verification, approval, or export readiness."}</dd>
        </div>
      </dl>

      {items.length > 0 ? (
        <div className="detail-completeness-list" aria-label="Enrichment jobs">
          {items.map((item) => (
            <article className={`detail-completeness-item detail-completeness-item--${item.state}`} key={item.id}>
              <div className="detail-completeness-item__lead">
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                  <p className="muted-copy">
                    Requested {formatDateTime(item.requestedAt)}
                    {item.completedAt ? ` · Completed ${formatDateTime(item.completedAt)}` : ""}
                  </p>
                </div>
                <StatusBadge label={item.stateLabel} tone={mapViewToneToBadge(item.tone)} />
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
