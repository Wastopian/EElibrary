/**
 * File header: Renders the answer-first "can I use this part?" decision card.
 */

import { StatusBadge } from "@ee-library/ui";
import type { Asset } from "@ee-library/shared/types";
import React from "react";
import { buildUseDecision, datasheetAssetLabel } from "../lib/format";
import type { PartDetailPageRecord } from "../lib/types";
import type { PartNextAction, getAssetTruthSummary } from "../../../../lib/detail-view-model";

/**
 * Renders the answer-first decision card above the audit-heavy detail sections.
 */
export function DetailUseDecision({
  assetTruthSummary,
  datasheetAsset,
  latestSource,
  nextAction,
  record
}: {
  assetTruthSummary: ReturnType<typeof getAssetTruthSummary>;
  datasheetAsset: Asset | undefined;
  latestSource: PartDetailPageRecord["sources"][number] | undefined;
  nextAction: PartNextAction | undefined;
  record: PartDetailPageRecord;
}) {
  const decision = buildUseDecision(record);

  return (
    <section aria-label="Use decision" className="detail-use-decision">
      <div className="detail-use-decision__header">
        <span>Use decision</span>
        <StatusBadge label={decision.label} tone={decision.tone} />
      </div>
      <strong>{decision.headline}</strong>
      <p>{decision.detail}</p>

      <dl className="detail-use-decision__facts">
        <div>
          <dt>Datasheet</dt>
          <dd>{datasheetAssetLabel(datasheetAsset)}</dd>
        </div>
        <div>
          <dt>CAD/export</dt>
          <dd>{assetTruthSummary.label}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{latestSource ? `${latestSource.providerId} / ${latestSource.providerPartKey}` : "No source row"}</dd>
        </div>
      </dl>

      {nextAction ? (
        <a className={`button-link ${nextAction.available ? "" : "button-link--quiet"}`} href={nextAction.href}>
          {nextAction.label}
        </a>
      ) : null}
    </section>
  );
}
