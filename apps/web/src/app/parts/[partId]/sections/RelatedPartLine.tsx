/**
 * File header: Renders a related part line with confidence and optional notes.
 */

import type { MateRelation, RelatedPartSummary } from "@ee-library/shared/types";

import React from "react";
/**
 * Renders a related part line with confidence and optional notes.
 */
export function RelatedPartLine({ relation, related }: { relation: MateRelation; related: RelatedPartSummary | null }) {
  return (
    <p>
      <span className="ui-mono">{related?.mpn ?? relation.matePartId}</span>
      <span> - confidence {Math.round(relation.confidenceScore * 100)}%</span>
      {relation.notes ? <span> ({relation.notes})</span> : null}
    </p>
  );
}
