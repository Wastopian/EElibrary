/**
 * File header: Shared compare-workspace recovery states with operator-friendly next actions.
 */

import Link from "next/link";
import React from "react";
import { EmptyState } from "@ee-library/ui";

/**
 * Renders first-run compare guidance with route-level actions instead of URL editing instructions.
 */
export function CompareNoPartsRecovery() {
  return (
    <div className="empty-recovery-state">
      <EmptyState
        body="Add exact MPNs or internal part ids above. Compare resolves only saved catalog records, so ambiguous search terms stay out of the table."
        title="No parts selected"
      />
      <div className="compare-starter-examples" aria-label="Compare starter examples">
        <strong>Try a saved comparison</strong>
        <div>
          <Link href="/compare?parts=TPS7A02DBVR,STM32G031K8T6">TPS7A02DBVR + STM32G031K8T6</Link>
          <Link href="/compare?parts=AMPHENOL-C091-5P-HSG,AMPHENOL-C091-5P-MATE">C091 housing + mate</Link>
          <Link href="/catalog?category=Connector">Browse connector candidates</Link>
        </div>
      </div>
      <div className="empty-recovery-actions" aria-label="Compare recovery actions">
        <Link className="button-link" href="/catalog">Find parts in Catalog</Link>
        <Link className="button-link button-link--quiet" href="/projects">Open project BOMs</Link>
      </div>
    </div>
  );
}

/**
 * Renders no-match compare guidance without implying missing ids are valid catalog records.
 */
export function CompareMissingPartsRecovery() {
  return (
    <div className="empty-recovery-state">
      <EmptyState body="Those parts are not in the catalog yet. Search the catalog for the exact part number, then open it to add a record." title="No matching parts found" />
      <div className="empty-recovery-actions" aria-label="Missing compare part recovery actions">
        <Link className="button-link" href="/catalog">Find parts in Catalog</Link>
        <Link className="button-link button-link--quiet" href="/system">Check system health</Link>
      </div>
    </div>
  );
}
