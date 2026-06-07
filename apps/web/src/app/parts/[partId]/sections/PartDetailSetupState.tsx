/**
 * File header: Renders the part detail setup-required state when the catalog API is
 * not reachable, while keeping the side-channel where-used history visible.
 */

import Link from "next/link";
import React from "react";
import { SectionHeading, SectionPanel } from "@ee-library/ui";
import { getSetupStateCopy } from "../../../../lib/setup-state-copy";
import { PartWhereUsedPanel } from "./PartWhereUsedPanel";
import type { PartDetailPageState } from "../lib/types";

/**
 * Renders setup guidance when detail truth cannot be loaded from the catalog API.
 */
export function PartDetailSetupState({ state }: { state: Extract<PartDetailPageState, { status: "setup_required" }> }) {
  const copy = getSetupStateCopy(state.code);

  return (
    <main className="detail-layout">
      <div className="detail-nav-links">
        <Link className="back-link" href="/catalog">
          &larr; Back to catalog
        </Link>
      </div>

      <section className="detail-section" aria-labelledby="part-detail-setup-heading">
        <SectionHeading
          id="part-detail-setup-heading"
          index="01"
          subtitle={copy.body}
          title={copy.headline}
        />
        <SectionPanel description="Once the catalog is reachable, this part record will load on its own." title="What you can do now">
          <div className="setup-steps">
            <div>
              <strong>Try again in a moment</strong>
              <span>If you opened this from a link, refresh after a minute.</span>
            </div>
            <div>
              <strong>Check service status</strong>
              <span>Open <Link href="/system">System</Link> to see what is offline.</span>
            </div>
            <div>
              <strong>Need an admin?</strong>
              <span>Share the technical details below so they can bring the catalog online.</span>
            </div>
          </div>
        </SectionPanel>
        <details className="audit-disclosure detail-audit-disclosure">
          <summary>Show technical details</summary>
          <div className="setup-steps">
            <div>
              <strong>Detail read failed</strong>
              <span>{state.code}: {state.message}</span>
              <code>{state.partId}</code>
            </div>
            <div>
              <strong>Bring the catalog online</strong>
              <code>$env:DATABASE_URL=&quot;postgres://ee_library:ee_library@127.0.0.1:5432/ee_library&quot;</code>
              <code>npm run db:migrate</code>
              <code>npm run dev</code>
            </div>
          </div>
        </details>
        <SectionPanel description="Usage history loads separately, so it can still appear here." title="Project usage history">
          <PartWhereUsedPanel state={state.whereUsedState} />
        </SectionPanel>
      </section>
    </main>
  );
}
