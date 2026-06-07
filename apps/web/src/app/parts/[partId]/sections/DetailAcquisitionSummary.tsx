/**
 * File header: Renders the acquisition/source summary without pretending import implies
 * approval or export readiness.
 */

import { StatusBadge } from "@ee-library/ui";
import React from "react";
import { getPartAcquisitionStateLabel } from "../../../../lib/detail-view-model";
import { formatDateTime } from "../lib/format";
import { acquisitionJobStatusTone, mapViewToneToBadge } from "../lib/tone";
import type { PartDetailPageDetail } from "../lib/types";

/**
 * Renders the acquisition/source summary without pretending import implies approval or export readiness.
 */
export function DetailAcquisitionSummary({
  acquisitionSummary,
  boundaryCopy,
  summarySignal
}: {
  acquisitionSummary: PartDetailPageDetail["acquisitionSummary"];
  boundaryCopy: string | null;
  summarySignal: ReturnType<typeof getPartAcquisitionStateLabel>;
}) {
  return (
    <div className="detail-acquisition-summary">
      <div className="detail-acquisition-summary__lead">
        <div>
          <p className="app-kicker">Where this part came from</p>
          <h3>{summarySignal.label}</h3>
          <p>{summarySignal.detail}</p>
        </div>
        <div className="detail-acquisition-summary__badges">
          <StatusBadge label={summarySignal.label} tone={mapViewToneToBadge(summarySignal.tone)} />
          {acquisitionSummary.lastJobStatus ? <StatusBadge label={`Job ${acquisitionSummary.lastJobStatus}`} tone={acquisitionJobStatusTone(acquisitionSummary.lastJobStatus)} /> : null}
        </div>
      </div>

      {boundaryCopy ? (
        <p className="detail-acquisition-summary__boundary">
          <strong>{boundaryCopy}</strong> Use the checklist below to see what still needs review before you use or export this part.
        </p>
      ) : null}

      <dl className="detail-acquisition-grid">
        <div>
          <dt>Supplier</dt>
          <dd>{acquisitionSummary.providerId ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Supplier&apos;s ID for this part</dt>
          <dd className="ui-mono">{acquisitionSummary.providerPartKey ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>What we searched for</dt>
          <dd className="ui-mono">{acquisitionSummary.requestedLookup ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Manufacturer</dt>
          <dd>{acquisitionSummary.manufacturerName ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>MPN</dt>
          <dd className="ui-mono">{acquisitionSummary.mpn ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Latest job status</dt>
          <dd>{acquisitionSummary.lastJobStatus ?? "No job recorded"}</dd>
        </div>
        <div>
          <dt>Requested at</dt>
          <dd>{acquisitionSummary.requestedAt ? formatDateTime(acquisitionSummary.requestedAt) : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Completed at</dt>
          <dd>{acquisitionSummary.completedAt ? formatDateTime(acquisitionSummary.completedAt) : "Not recorded"}</dd>
        </div>
        <div className="detail-acquisition-grid__wide">
          <dt>Source URL</dt>
          <dd>
            {acquisitionSummary.sourceUrl ? (
              <a href={acquisitionSummary.sourceUrl}>{acquisitionSummary.sourceUrl}</a>
            ) : (
              "No source link recorded"
            )}
          </dd>
        </div>
        {acquisitionSummary.reason ? (
          <div className="detail-acquisition-grid__wide">
            <dt>Import note</dt>
            <dd>{acquisitionSummary.reason}</dd>
          </div>
        ) : null}
        {acquisitionSummary.requestedBy ? (
          <div>
            <dt>Requested by</dt>
            <dd>{acquisitionSummary.requestedBy}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
