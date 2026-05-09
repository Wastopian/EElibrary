/**
 * File header: Renders the vendor notebook list page.
 *
 * Engineers come here to find which fab houses, sheet metal shops, and assembly
 * partners the team has used and what was learned about each. The page reads from the
 * filesystem-backed vendor mirror, so DB outages do not block this surface.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel } from "@ee-library/ui";
import { VendorCreatePanel } from "../../components/VendorCreatePanel";
import { VendorsBrowser } from "../../components/VendorsBrowser";
import { fetchVendorList, isApiClientError } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import type { VendorListResponse } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** VendorsDashboardState separates ready reads from setup/recovery states. */
type VendorsDashboardState =
  | { status: "ready"; response: VendorListResponse }
  | { status: "setup_required"; code: string; message: string };

/**
 * Renders the vendor notebook dashboard. Three layouts: ready (with vendors or empty),
 * not-configured (mirror disabled), or generic API failure.
 */
export default async function VendorsPage() {
  const state = await loadVendors();

  if (state.status === "setup_required") {
    return <VendorsSetupState code={state.code} message={state.message} />;
  }

  const { response } = state;

  if (response.availability === "not_configured") {
    return <VendorsNotConfiguredState />;
  }

  if (response.availability === "error") {
    return <VendorsErrorState message={response.message ?? "The vendor notebook could not read its folder on disk."} />;
  }

  return (
    <main className="projects-layout">
      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Suppliers</p>
          <h1>Who we use</h1>
          <p className="projects-hero__lede">
            PCB shops, sheet metal, machining, finishing, assembly — one place for quality notes and reference files.
          </p>
          <div className="empty-recovery-actions" aria-label="Supplier quick actions">
            <a className="button-link" href="#vendor-create-heading">
              {response.vendors.length > 0 ? "Add another supplier" : "Add a supplier"}
            </a>
          </div>
          {response.rootPath ? (
            <details className="vendors-notebook-path">
              <summary>Where this list is saved</summary>
              <p className="muted-copy">
                Files for your team live on the computer that runs the API, under:{" "}
                <code className="ui-mono">{response.rootPath}</code>
              </p>
            </details>
          ) : null}
        </div>
      </section>

      {response.vendors.length > 0 ? (
        <>
          <section className="detail-section" aria-labelledby="vendors-list-heading">
            <SectionHeading
              id="vendors-list-heading"
              subtitle="Filter by type, then search. Open a row for notes and uploads."
              title="Your suppliers"
            />
            <SectionPanel
              description="Notes are for what you learned (lead times, issues, wins). Files are for PDFs and drawings."
              title={`${response.vendors.length} supplier${response.vendors.length === 1 ? "" : "s"}`}
            >
              <VendorsBrowser vendors={response.vendors} />
            </SectionPanel>
          </section>

          <section className="detail-section" aria-labelledby="vendor-create-heading">
            <SectionHeading
              id="vendor-create-heading"
              subtitle="Name and type are enough. You can add notes on the next screen."
              title="Add a supplier"
            />
            <SectionPanel description="Creates a folder so the team can drop files or upload here." title="New supplier">
              <VendorCreatePanel />
            </SectionPanel>
          </section>
        </>
      ) : (
        <>
          <section className="detail-section" aria-labelledby="vendor-create-heading">
            <SectionHeading
              id="vendor-create-heading"
              subtitle="Pick a name and what kind of shop it is. You will land on their page to add notes."
              title="Add your first supplier"
            />
            <SectionPanel description="Takes a few seconds. Everyone on the team can see what you add." title="New supplier">
              <VendorCreatePanel />
            </SectionPanel>
          </section>

          <section className="detail-section" aria-labelledby="vendors-list-heading">
            <SectionHeading id="vendors-list-heading" subtitle="After you add one, it shows up here." title="Your suppliers" />
            <SectionPanel description="The list stays empty until someone adds a supplier above." title="No suppliers yet">
              <VendorsEmptyState />
            </SectionPanel>
          </section>
        </>
      )}
    </main>
  );
}

/**
 * Loads the vendor list with explicit setup-failure handling so the page can render a
 * plain-language recovery state without leaking stack traces.
 */
async function loadVendors(): Promise<VendorsDashboardState> {
  try {
    const response = await fetchVendorList();
    return { status: "ready", response };
  } catch (error) {
    if (isApiClientError(error)) {
      return { status: "setup_required", code: error.code, message: error.message };
    }
    return {
      status: "setup_required",
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so vendor notes cannot be read."
    };
  }
}

/**
 * Renders the specific layout used when EE_LIBRARY_VENDOR_NOTES_ROOT is disabled. The
 * copy keeps the surface honest about what is needed, without leaking framework jargon.
 */
function VendorsNotConfiguredState() {
  return (
    <main className="projects-layout">
      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Suppliers</p>
          <h1>Supplier list is not set up</h1>
          <p className="projects-hero__lede">
            Ask whoever runs the EE Library app to turn on the supplier folder. Then reload this page.
          </p>
          <details className="import-guide">
            <summary>For the person who runs the server</summary>
            <p className="mode-warning">
              Set <code className="ui-mono">EE_LIBRARY_VENDOR_NOTES_ROOT</code> on the API machine to a folder path your team can write to,
              then restart the API if needed.
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}

/** Renders the generic "filesystem read failed" state. */
function VendorsErrorState({ message }: { message: string }) {
  return (
    <main className="projects-layout">
      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Suppliers</p>
          <h1>Could not read the supplier folder</h1>
          <p className="projects-hero__lede">{message}</p>
        </div>
      </section>
    </main>
  );
}

/** Renders the generic API-unavailable recovery state. */
function VendorsSetupState({ code, message }: { code: string; message: string }) {
  const copy = getSetupStateCopy(code);
  return (
    <main className="projects-layout">
      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Suppliers</p>
          <h1>{copy.headline}</h1>
          <p className="projects-hero__lede">{copy.body}</p>
          <details className="import-guide">
            <summary>Show technical details</summary>
            <p className="mode-warning">{message}</p>
            <p className="mode-warning">Status code: {code}</p>
          </details>
        </div>
      </section>
    </main>
  );
}

/** Renders the configured-but-empty vendor list state. */
function VendorsEmptyState() {
  return (
    <EmptyState
      title="No suppliers yet"
      body="Use Add your first supplier above. Your team will see everyone you add here."
    />
  );
}
