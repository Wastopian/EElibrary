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
        body="Find a catalog part first, then choose the compare workspace from that part. You can also add a known internal part id in the compare selection box."
        title="No parts selected"
      />
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
      <EmptyState body="The selected ids did not resolve to catalog parts. Search Catalog for the exact MPN, then add the internal part record from the part workspace." title="No matching parts found" />
      <div className="empty-recovery-actions" aria-label="Missing compare part recovery actions">
        <Link className="button-link" href="/catalog">Search Catalog</Link>
        <Link className="button-link button-link--quiet" href="/system">Check system health</Link>
      </div>
    </div>
  );
}
