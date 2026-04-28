/**
 * File header: Landing page — entry point before the catalog workspace.
 */

import Link from "next/link";
import React from "react";
import { StatusBadge } from "@ee-library/ui";
import { fetchApiHealth, fetchSearchFacetsEnvelope, fetchSystemHealth } from "../lib/api-client";
import { WorkerStatusBanner } from "../components/WorkerStatusBanner";

export const dynamic = "force-dynamic";

/**
 * Renders the EE Library landing page with value props and live catalog status.
 */
export default async function LandingPage() {
  const [health, facetsEnvelope, systemHealth] = await Promise.all([
    fetchApiHealth().catch(() => null),
    fetchSearchFacetsEnvelope({}).catch(() => null),
    fetchSystemHealth().catch(() => null)
  ]);
  const dbStatus = health?.dependencies.database ?? "unknown";
  const dbConnected = dbStatus === "connected";
  const readinessCounts = facetsEnvelope?.data?.counts?.readinessStatuses ?? null;
  const apiBaseUrl = process.env["EE_LIBRARY_API_BASE_URL"] ?? "http://127.0.0.1:4000";
  const isLocalDev = (process.env["LOCAL_DEV"] ?? "").toLowerCase() !== "false" && process.env["NODE_ENV"] !== "production";
  const databaseUrlConfigured = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL"].trim());

  return (
    <main className="landing">
      <WorkerStatusBanner
        apiBaseUrl={apiBaseUrl}
        databaseUrlConfigured={databaseUrlConfigured}
        health={systemHealth}
        isLocalDev={isLocalDev}
      />
      <section className="landing-hero">
        <div className="landing-hero__inner">
          <p className="landing-hero__eyebrow">EE Library</p>
          <h1 className="landing-hero__headline">
            Engineering readiness,<br />
            <span className="landing-hero__headline-accent">without pretending.</span>
          </h1>
          <p className="landing-hero__lede">
            Know whether a component is actually ready for export — verified file-backed CAD, connector build sets, and lifecycle truth. Not just &ldquo;in the catalog.&rdquo;
          </p>

          <div className="landing-hero__actions">
            <Link className="button-link landing-hero__cta-primary" href="/catalog">
              Open catalog
            </Link>
            <Link className="button-link button-link--quiet landing-hero__cta-secondary" href="/admin">
              Admin queue
            </Link>
          </div>

          <div className="landing-hero__status">
            <StatusBadge
              label={dbConnected ? "DB connected" : health ? `DB ${dbStatus}` : "API unavailable"}
              tone={dbConnected ? "verified" : "review"}
            />
            <StatusBadge
              label={dbConnected ? "Live catalog" : "Seed mode available"}
              tone={dbConnected ? "info" : "neutral"}
            />
          </div>
        </div>

        <div className="landing-hero__diagram">
          <div className="landing-catalog-snapshot">
            <p className="landing-catalog-snapshot__label">
              {readinessCounts ? "Live catalog readiness" : "Readiness model"}
            </p>
            <div className="landing-catalog-snapshot__rows">
              <div className="landing-snapshot-row landing-snapshot-row--verified">
                <span className="landing-snapshot-row__dot" />
                <span className="landing-snapshot-row__name">Ready for export review</span>
                <span className="landing-snapshot-row__count">
                  {readinessCounts ? (readinessCounts["ready_for_export_review"] ?? 0) : "—"}
                </span>
              </div>
              <div className="landing-snapshot-row landing-snapshot-row--review">
                <span className="landing-snapshot-row__dot" />
                <span className="landing-snapshot-row__name">Needs attention</span>
                <span className="landing-snapshot-row__count">
                  {readinessCounts ? (readinessCounts["needs_attention"] ?? 0) : "—"}
                </span>
              </div>
              <div className="landing-snapshot-row landing-snapshot-row--blocked">
                <span className="landing-snapshot-row__dot" />
                <span className="landing-snapshot-row__name">Blocked</span>
                <span className="landing-snapshot-row__count">
                  {readinessCounts ? (readinessCounts["blocked"] ?? 0) : "—"}
                </span>
              </div>
            </div>
            <Link className="landing-catalog-snapshot__cta" href="/catalog">
              Open catalog workspace →
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-pillars" aria-label="Core capabilities">
        <div className="landing-pillar">
          <div className="landing-pillar__icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="landing-pillar__title">Part readiness truth</h2>
          <p className="landing-pillar__body">
            Blockers stay visible. &ldquo;Ready for export&rdquo; means verified file-backed CAD assets exist — not just catalog presence or review approval alone.
          </p>
          <Link className="landing-pillar__link" href="/catalog?readinessStatus=blocked">
            View blocked parts →
          </Link>
        </div>

        <div className="landing-pillar">
          <div className="landing-pillar__icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M13.5 13.5m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <h2 className="landing-pillar__title">CAD asset truth</h2>
          <p className="landing-pillar__body">
            Referenced, downloaded, generated, and verified stay separated. Each asset carries its own availability, review, and export status — no vague &ldquo;CAD available&rdquo; claims.
          </p>
          <Link className="landing-pillar__link" href="/catalog?cad=unavailable">
            Review missing CAD →
          </Link>
        </div>

        <div className="landing-pillar">
          <div className="landing-pillar__icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="5" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="15" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7.5 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M5 7.5V5M15 7.5V5M5 12.5V15M15 12.5V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="landing-pillar__title">Connector intelligence</h2>
          <p className="landing-pillar__body">
            Mates, required accessories, cable options, and tooling — with confidence scores and explicit uncertainty shown, not hidden behind a single compatibility status.
          </p>
          <Link className="landing-pillar__link" href="/catalog?category=Connector">
            Browse connectors →
          </Link>
        </div>
      </section>

      <section className="landing-trust-model" aria-label="Trust model overview">
        <div className="landing-trust-model__inner">
          <div className="landing-trust-model__copy">
            <p className="landing-hero__eyebrow">Trust model</p>
            <h2>Three things that stay separate</h2>
            <p>
              Most catalog tools collapse these into one vague status. EE Library keeps them distinct so decisions are grounded in evidence, not assumption.
            </p>
            <Link className="button-link button-link--quiet" href="/catalog">
              Start a readiness check
            </Link>
          </div>
          <div className="landing-trust-model__items">
            <div className="landing-trust-item">
              <strong>Asset availability</strong>
              <p>Does the file exist locally? Is it referenced only, downloaded, validated, or failed?</p>
            </div>
            <div className="landing-trust-item">
              <strong>Engineering review</strong>
              <p>Has an engineer approved the asset? Approval does not equal export readiness.</p>
            </div>
            <div className="landing-trust-item">
              <strong>Export verification</strong>
              <p>Is the file validated, file-backed, and explicitly promoted for verified export?</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-entry" aria-label="Workspace entry">
        <div className="landing-entry__inner">
          <div className="landing-entry__card">
            <p className="app-kicker">Catalog workspace</p>
            <h3>Search and triage</h3>
            <p>Quick readiness checks, engineering filter rail, and part-level blockers at a glance.</p>
            <Link className="button-link" href="/catalog">Open catalog workspace</Link>
          </div>
          <div className="landing-entry__card">
            <p className="app-kicker">Admin queue</p>
            <h3>Review and promote</h3>
            <p>Asset review queues, export promotion, failed import diagnostics, and issue operations.</p>
            <Link className="button-link button-link--quiet" href="/admin">Open admin queue</Link>
          </div>
          <div className="landing-entry__card">
            <p className="app-kicker">Quick import</p>
            <h3>Bring in a part</h3>
            <p>Search supported providers for exact MPN matches and queue acquisition into the catalog.</p>
            <Link className="button-link button-link--quiet" href="/catalog#import-by-mpn">Import by MPN</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
