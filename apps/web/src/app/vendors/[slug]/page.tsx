/**
 * File header: Renders the per-vendor workspace.
 *
 * Engineers come here to capture and review what the team learned about one supplier:
 * quality observations, lead times, contact details, capability sheets. Notes and files
 * are mirrored on disk so engineers can also work directly with their OS.
 */

import Link from "next/link";
import React from "react";
import { SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { VendorWorkspace } from "../../../components/VendorWorkspace";
import { fetchVendorDetail, isApiClientError } from "../../../lib/api-client";
import { getSetupStateCopy } from "../../../lib/setup-state-copy";
import type { VendorCategory, VendorDetailResponse } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** VENDOR_CATEGORY_LABELS provides display names; keep aligned with VendorsBrowser. */
const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  pcb_fab: "PCB fab",
  sheet_metal: "Sheet metal",
  machining: "Machining",
  finishing: "Anodize / finishing",
  electronics_assembly: "Electronics assembly",
  distributor: "Distributor",
  other: "Other"
};

/** VendorDetailState separates ready reads from setup/recovery and not-found states. */
type VendorDetailState =
  | { status: "ready"; response: VendorDetailResponse }
  | { status: "setup_required"; code: string; message: string };

/**
 * Renders one vendor's workspace. The page route handles missing slugs and disabled
 * mirrors here; the workspace component focuses on the everyday workflow.
 */
export default async function VendorDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const slug = decodeURIComponent(resolvedParams.slug);

  const state = await loadVendorDetail(slug);

  if (state.status === "setup_required") {
    const copy = getSetupStateCopy(state.code);
    return (
      <main className="projects-layout">
        <Link className="back-link" href="/vendors">&larr; All suppliers</Link>
        <section className="projects-hero projects-hero--slim">
          <div className="projects-hero__copy">
            <p className="app-kicker">Suppliers</p>
            <h1>{copy.headline}</h1>
            <p className="projects-hero__lede">{copy.body}</p>
            <details className="import-guide">
              <summary>Show technical details</summary>
              <p className="mode-warning">{state.message}</p>
              <p className="mode-warning">Status code: {state.code}</p>
            </details>
          </div>
        </section>
      </main>
    );
  }

  const { response } = state;

  if (response.availability === "configured" && !response.vendor) {
    return (
      <main className="projects-layout">
        <Link className="back-link" href="/vendors">&larr; All suppliers</Link>
        <section className="projects-hero projects-hero--slim">
          <div className="projects-hero__copy">
            <p className="app-kicker">Suppliers</p>
            <h1>We couldn&apos;t find that supplier</h1>
            <p className="projects-hero__lede">Check the list — the name may have changed, or the record was removed.</p>
            <div className="empty-recovery-actions">
              <Link className="button-link button-link--quiet" href="/vendors">Open supplier list</Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const vendor = response.vendor;

  return (
    <main className="projects-layout">
      <Link className="back-link" href="/vendors">&larr; All suppliers</Link>

      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Supplier</p>
          <h1>{vendor?.name ?? slug}</h1>
          {vendor?.summary ? <p className="projects-hero__lede">{vendor.summary}</p> : null}
          {vendor ? (
            <div className="projects-hero__status">
              <StatusBadge label={VENDOR_CATEGORY_LABELS[vendor.category]} tone="info" />
              <StatusBadge label={`${response.notes.length} note${response.notes.length === 1 ? "" : "s"}`} tone="neutral" />
              <StatusBadge label={`${response.files.length} file${response.files.length === 1 ? "" : "s"}`} tone="neutral" />
            </div>
          ) : null}
        </div>
      </section>

      <section className="detail-section" aria-labelledby="vendor-workspace-heading">
        <SectionHeading
          id="vendor-workspace-heading"
          subtitle="Write what the team should remember. Add PDFs or drawings under reference files."
          title="Notes and reference files"
        />
        <SectionPanel
          description="Type a note below, or upload. If you use a shared folder instead, drop files in the paths shown — refresh to see them here."
          title="Workspace"
        >
          <VendorWorkspace detail={response} />
        </SectionPanel>
      </section>
    </main>
  );
}

/** Loads the detail bundle with explicit setup-failure handling. */
async function loadVendorDetail(slug: string): Promise<VendorDetailState> {
  try {
    const response = await fetchVendorDetail(slug);
    return { status: "ready", response };
  } catch (error) {
    if (isApiClientError(error)) {
      return { status: "setup_required", code: error.code, message: error.message };
    }
    return {
      status: "setup_required",
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so vendor detail cannot be read."
    };
  }
}
