/**
 * File header: Renders the Area 2 interconnect workspace shell.
 *
 * The server component owns loading and setup states. The interactive record browser
 * owns client-side lookup across cable assemblies, fixture ports, and pin maps.
 */

import Link from "next/link";
import React from "react";
import { SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { InterconnectBrowser } from "./InterconnectBrowser";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchInterconnectDashboard, isApiClientError } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { InterconnectDashboardResponse } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** InterconnectsPageState separates ready dashboard reads from setup and API failures. */
type InterconnectsPageState =
  | { health: ApiHealth | null; response: InterconnectDashboardResponse; status: "ready" }
  | { code: string; health: ApiHealth | null; message: string; status: "setup_required" };

/** Renders the interconnect memory workspace for Area 2. */
export default async function InterconnectsPage() {
  const pageState = await loadInterconnectsPage();

  if (pageState.status === "setup_required") {
    return <InterconnectsSetupState pageState={pageState} />;
  }

  const { health, response } = pageState;

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Interconnects</p>
            <h1>Cable and fixture memory</h1>
            <p className="projects-hero__lede">
              Find cable assemblies, fixture ports, connector pins, and signals from one
              workstation view. Records show what is on file and keep uncertainty visible.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Database connected" tone="verified" />
              <StatusBadge
                label={health ? `API ${health.status}` : "API health unavailable"}
                tone={health ? "info" : "review"}
              />
              <StatusBadge
                label={`Database ${health?.dependencies.database ?? "unknown"}`}
                tone={health?.dependencies.database === "connected" ? "verified" : "review"}
              />
            </div>
            <p className="projects-hero__lede">
              <Link className="button-primary" href="/interconnects/cables/new">New cable</Link>
            </p>
          </div>
          <InterconnectSnapshot response={response} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Interconnect sections"
        items={[
          { href: "#interconnect-find-heading", label: "Find records" },
          { href: "#interconnect-limits-heading", label: "Limits" }
        ]}
      />

      <InterconnectBrowser response={response} />

      <section className="detail-section" aria-labelledby="interconnect-limits-heading">
        <SectionHeading
          id="interconnect-limits-heading"
          index="02"
          subtitle="This workspace records engineering memory. It does not replace verification on the bench."
          title="What this page does not decide"
        />
        <SectionPanel description={response.boundary} title="Use with engineering judgment">
          <div className="projects-truth-rail projects-truth-rail--compact">
            <div>
              <span>Part approval</span>
              <strong>Matched connectors stay separate from part approval.</strong>
              <p>A matched part link helps lookup, but it does not approve the part or review its files.</p>
            </div>
            <div>
              <span>Bench safety</span>
              <strong>Reuse still needs a human check.</strong>
              <p>Pin maps can be wrong, old, or incomplete. The page shows confidence instead of certainty.</p>
            </div>
            <div>
              <span>Downloads</span>
              <strong>Downloads depend on real files being available.</strong>
              <p>Cable and fixture records do not make CAD, drawings, or packages ready to download.</p>
            </div>
          </div>
        </SectionPanel>
      </section>
    </main>
  );
}

/** Loads the interconnect dashboard while preserving setup failures for the page. */
async function loadInterconnectsPage(): Promise<InterconnectsPageState> {
  const healthPromise = fetchApiHealth().catch(() => null);

  try {
    const [health, response] = await Promise.all([healthPromise, fetchInterconnectDashboard()]);
    return { health, response, status: "ready" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        health: await healthPromise,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      health: await healthPromise,
      message: "The API could not be reached, so the interconnect workspace cannot be read.",
      status: "setup_required"
    };
  }
}

/** Renders setup guidance when the interconnect dashboard cannot be read. */
function InterconnectsSetupState({
  pageState
}: {
  pageState: Extract<InterconnectsPageState, { status: "setup_required" }>;
}) {
  const copy = getSetupStateCopy(pageState.code);

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Interconnects</p>
          <h1>{copy.headline}</h1>
          <p className="projects-hero__lede">
            {copy.body} Cable and fixture memory needs the interconnect tables in the catalog database.
          </p>
          <div className="projects-hero__status">
            <StatusBadge
              label={`Database ${pageState.health?.dependencies.database ?? "unknown"}`}
              tone={pageState.health?.dependencies.database === "connected" ? "verified" : "review"}
            />
          </div>
          <details className="audit-disclosure">
            <summary>Show technical details</summary>
            <p className="muted-copy">{pageState.code}: {pageState.message}</p>
          </details>
        </div>
      </section>
    </main>
  );
}

/** Renders the hero snapshot for the interconnect workspace. */
function InterconnectSnapshot({ response }: { response: InterconnectDashboardResponse }) {
  return (
    <div className="projects-hero__snapshot" aria-label="Interconnect summary">
      <InterconnectStat
        label="Cables"
        tone={response.summary.cableAssemblyCount > 0 ? "info" : "neutral"}
        value={response.summary.cableAssemblyCount.toString()}
      />
      <InterconnectStat
        label="Fixtures"
        tone={response.summary.fixtureCount > 0 ? "info" : "neutral"}
        value={response.summary.fixtureCount.toString()}
      />
      <InterconnectStat
        label="Pin rows"
        tone={response.summary.pinMapRowCount > 0 ? "verified" : "neutral"}
        value={response.summary.pinMapRowCount.toString()}
      />
      <InterconnectStat
        label="Pin rows to check"
        tone={response.summary.lowConfidencePinRowCount > 0 ? "review" : "neutral"}
        value={response.summary.lowConfidencePinRowCount.toString()}
      />
    </div>
  );
}

/** Renders one compact interconnect stat tile. */
function InterconnectStat({
  label,
  tone,
  value
}: {
  label: string;
  tone: BadgeTone;
  value: string;
}) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
