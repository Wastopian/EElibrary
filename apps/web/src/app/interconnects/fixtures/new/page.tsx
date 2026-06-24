/**
 * File header: Server shell for authoring a brand-new test fixture.
 */

import Link from "next/link";
import React from "react";
import { StatusBadge } from "@ee-library/ui";
import { FixtureCreateForm } from "../../FixtureCreateForm";
import { loadCableProjectOptions } from "../../project-options";

export const dynamic = "force-dynamic";

/** Renders the new-fixture authoring page. */
export default async function NewFixturePage() {
  const projectOptions = await loadCableProjectOptions();

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Interconnects</p>
            <h1>New test fixture</h1>
            <p className="projects-hero__lede">
              Record a bench fixture so the team can find its ports and the cables that plug into it.
              You can add ports after the fixture is created.
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
        <FixtureCreateForm projectOptions={projectOptions} />
      </section>
    </main>
  );
}
