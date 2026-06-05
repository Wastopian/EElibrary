/**
 * File header: Early engineering context panel keeping identity, mates, and package truth
 * visible near the readiness summary.
 */

import { StatusBadge } from "@ee-library/ui";
import React from "react";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import type { Asset, MateRelation, RelatedPartSummary } from "@ee-library/shared/types";
import { buildConnectorConfidenceSummary, datasheetAssetLabel } from "../lib/format";
import {
  renderCableAssumptionList,
  renderMateRelationList,
  renderPart,
  renderRelatedList
} from "../lib/related-part";
import type { PartDetailPageRecord } from "../lib/types";

/**
 * Renders the early engineering context panel so identity, mates, and package truth stay near readiness.
 */
export function DetailContextPanel({
  bestMate,
  datasheetAsset,
  hasConnectorIntelligence,
  latestSource,
  record,
  relatedPartSummaries
}: {
  bestMate: MateRelation | undefined;
  datasheetAsset: Asset | undefined;
  hasConnectorIntelligence: boolean;
  latestSource: PartDetailPageRecord["sources"][number] | undefined;
  record: PartDetailPageRecord;
  relatedPartSummaries: RelatedPartSummary[];
}) {
  if (hasConnectorIntelligence) {
    const primaryConnectorWarning = record.buildableMatingSet.warningDetails[0] ?? null;

    return (
      <section className="detail-context-panel" aria-label="Connector build set">
        <div className="detail-context-panel__header">
          <div>
            <p className="app-kicker">Connector build set</p>
            <h3>Mates and accessories you need to build with this connector</h3>
          </div>
          <StatusBadge
            label={
              primaryConnectorWarning
                ? primaryConnectorWarning.summary
                : bestMate
                  ? "Best mate mapped"
                  : "Mate mapping incomplete"
            }
            tone={primaryConnectorWarning ? primaryConnectorWarning.tone : bestMate ? "info" : "review"}
          />
        </div>
        <p className="muted-copy">
          Based on the mate and accessory relationships we have on file. Double-check pitch, family, and mechanical fit before layout.
          {record.buildableMatingSet.confidenceScore !== null ? ` ${buildConnectorConfidenceSummary(record.buildableMatingSet)}` : ""}
        </p>
        {record.buildableMatingSet.warningDetails.length > 0 ? (
          <ul className="connector-list" style={{ marginBottom: 12 }}>
            {record.buildableMatingSet.warningDetails.map((warning) => (
              <li key={warning.code}>
                <strong>{warning.summary}</strong> {warning.detail}
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="detail-context-list">
          <li>
            <strong>Best mate</strong>
            <span>{bestMate ? renderPart(bestMate.matePartId, relatedPartSummaries) : "No best mate on file"}</span>
          </li>
          <li>
            <strong>Alternate mates</strong>
            <span>{renderMateRelationList(record.buildableMatingSet.alternateMates, relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Family conflicts</strong>
            <span>{renderRelatedList(record.buildableMatingSet.familyConflicts.map((item) => item.candidatePartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Required accessories</strong>
            <span>{renderRelatedList(record.buildableMatingSet.requiredAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Optional accessories</strong>
            <span>{renderRelatedList(record.buildableMatingSet.optionalAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Tooling</strong>
            <span>{renderRelatedList(record.buildableMatingSet.toolingRequirements.map((item) => item.accessoryPartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Compatible cables</strong>
            <span>{renderRelatedList(record.buildableMatingSet.cableOptions.map((item) => item.cablePartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Cable assumptions</strong>
            <span>{renderCableAssumptionList(record.buildableMatingSet.cableAssumptions, relatedPartSummaries)}</span>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="detail-context-panel" aria-label="Engineering context">
      <div className="detail-context-panel__header">
        <div>
          <p className="app-kicker">Engineering context</p>
          <h3>Identity and source evidence</h3>
        </div>
        <StatusBadge label={datasheetAssetLabel(datasheetAsset)} tone={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "verified" : "review"} />
      </div>
      <p className="muted-copy">Keeps package, lifecycle, and source info visible before the deeper audit details below.</p>
      <ul className="detail-context-list">
        <li>
          <strong>Package</strong>
          <span>{record.package.packageName}</span>
        </li>
        <li>
          <strong>Lifecycle</strong>
          <span>{record.part.lifecycleStatus}</span>
        </li>
        <li>
          <strong>Latest source</strong>
          <span>{latestSource ? `${latestSource.providerId} / ${latestSource.providerPartKey}` : "No source on file"}</span>
        </li>
        <li>
          <strong>Datasheet revision</strong>
          <span>{record.datasheetRevision?.revisionLabel ?? "No revision recorded"}</span>
        </li>
      </ul>
    </section>
  );
}
