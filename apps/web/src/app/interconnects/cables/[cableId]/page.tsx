/**
 * File header: Server shell that loads one cable's detail and mounts the authoring editor.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { CableDetailEditor } from "../../CableDetailEditor";
import { loadCableProjectOptions } from "../../project-options";
import { fetchCableAssemblyDetail, isApiClientError } from "../../../../lib/api-client";
import type { CableAssemblyDetail } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** CableDetailPageProps carries the dynamic cable id route param. */
interface CableDetailPageProps {
  params: Promise<{ cableId: string }>;
}

/** Loads and renders one cable's authoring page, or an honest unavailable state. */
export default async function CableDetailPage({ params }: CableDetailPageProps) {
  const { cableId } = await params;

  let detail: CableAssemblyDetail | null = null;
  let errorMessage: string | null = null;

  try {
    detail = await fetchCableAssemblyDetail(decodeURIComponent(cableId));
  } catch (error) {
    errorMessage = isApiClientError(error)
      ? error.message
      : "The cable workspace could not be read. Check that the API is running.";
  }

  const [projectOptions] = await Promise.all([loadCableProjectOptions()]);

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Interconnects</p>
            <h1>{detail ? `Cable ${detail.cable.cableKey}` : "Cable not available"}</h1>
            <p className="projects-hero__lede">
              {detail
                ? "Edit this cable's details, connector ends, and pin map. Changes are recorded memory only."
                : "This cable could not be opened."}
            </p>
            <div className="projects-hero__status">
              {detail ? <StatusBadge label={`Revision ${detail.cable.revisionLabel}`} tone="info" /> : null}
              {detail ? <StatusBadge label={formatStatusLabel(detail.cable.assemblyStatus)} tone="review" /> : null}
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
          ? <CableDetailEditor detail={detail} projectOptions={projectOptions} />
          : <EmptyState body={errorMessage ?? "Cable not found."} title="Cable unavailable" />}
      </section>
    </main>
  );
}

/** Formats a cable status for the hero badge. */
function formatStatusLabel(status: string): string {
  return status.split("_").map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ");
}
