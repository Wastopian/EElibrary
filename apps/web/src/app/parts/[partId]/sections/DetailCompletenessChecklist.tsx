/**
 * File header: Compact engineering-readiness checklist derived from existing detail truth only.
 */

import { StatusBadge } from "@ee-library/ui";
import type { DetailCompletenessChecklistItem } from "../../../../lib/detail-view-model";
import React from "react";
import { mapViewToneToBadge } from "../lib/tone";

/**
 * Renders the compact engineering-readiness checklist derived from existing detail truth only.
 */
export function DetailCompletenessChecklist({ items }: { items: DetailCompletenessChecklistItem[] }) {
  return (
    <div className="detail-completeness-list" aria-label="Completeness checklist">
      {items.map((item) => (
        <article className={`detail-completeness-item detail-completeness-item--${item.state}`} key={item.id}>
          <div className="detail-completeness-item__lead">
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <StatusBadge label={item.stateLabel} tone={mapViewToneToBadge(item.tone)} />
          </div>
        </article>
      ))}
    </div>
  );
}
