/**
 * File header: Server shell for authoring a brand-new cable assembly.
 */

import Link from "next/link";
import React from "react";
import { StatusBadge } from "@ee-library/ui";
import { CableCreateForm } from "../../CableCreateForm";
import { loadCableProjectOptions } from "../../project-options";

export const dynamic = "force-dynamic";

/** Renders the new-cable authoring page. */
export default async function NewCablePage() {
  const projectOptions = await loadCableProjectOptions();

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Interconnects</p>
            <h1>New cable assembly</h1>
            <p className="projects-hero__lede">
              Record a cable so the team can find its connectors, pins, and signals later. You can add
              connector ends and pin rows after the cable is created.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Engineering memory" tone="review" />
              <StatusBadge label="No approval implied" tone="info" />
            </div>
            <p className="projects-hero__lede">
              <Link className="button-link button-link--quiet" href="/interconnects">Back to cables &amp; fixtures</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="detail-section">
        <CableCreateForm projectOptions={projectOptions} />
      </section>
    </main>
  );
}
