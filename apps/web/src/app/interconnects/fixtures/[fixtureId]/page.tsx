/**
 * File header: Server shell that loads one fixture's detail and mounts the authoring editor.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { FixtureDetailEditor } from "../../FixtureDetailEditor";
import { loadCableProjectOptions } from "../../project-options";
import { fetchTestFixtureDetail, isApiClientError } from "../../../../lib/api-client";
import type { TestFixtureDetail } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** FixtureDetailPageProps carries the dynamic fixture id route param. */
interface FixtureDetailPageProps {
  params: Promise<{ fixtureId: string }>;
}

/** Loads and renders one fixture's authoring page, or an honest unavailable state. */
export default async function FixtureDetailPage({ params }: FixtureDetailPageProps) {
  const { fixtureId } = await params;

  let detail: TestFixtureDetail | null = null;
  let errorMessage: string | null = null;

  try {
    detail = await fetchTestFixtureDetail(decodeURIComponent(fixtureId));
  } catch (error) {
    errorMessage = isApiClientError(error)
      ? error.message
      : "The fixture workspace could not be read. Check that the API is running.";
  }

  const projectOptions = await loadCableProjectOptions();

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Interconnects</p>
            <h1>{detail ? `Fixture ${detail.fixture.fixtureKey}` : "Fixture not available"}</h1>
            <p className="projects-hero__lede">
              {detail
                ? "Edit this fixture's details and ports. Changes are recorded memory only."
                : "This fixture could not be opened."}
            </p>
            <div className="projects-hero__status">
              {detail ? <StatusBadge label={`Revision ${detail.fixture.revisionLabel}`} tone="info" /> : null}
              {detail ? <StatusBadge label={formatStatusLabel(detail.fixture.fixtureStatus)} tone="review" /> : null}
              <StatusBadge label="No approval implied" tone="info" />
            </div>
            <p className="projects-hero__lede">
              <Link className="button-link button-link--quiet" href="/interconnects">Back to cables &amp; fixtures</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="detail-section">
        {detail
          ? <FixtureDetailEditor detail={detail} projectOptions={projectOptions} />
          : <EmptyState body={errorMessage ?? "Fixture not found."} title="Fixture unavailable" />}
      </section>
    </main>
  );
}

/** Formats a fixture status for the hero badge. */
function formatStatusLabel(status: string): string {
  return status.split("_").map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ");
}
