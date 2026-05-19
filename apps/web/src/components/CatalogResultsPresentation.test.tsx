/**
 * File header: Tests the interactive catalog results presentation over backend-backed view models.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogResultsPresentation } from "./CatalogResultsPresentation";
import type { CatalogResultRowViewModel } from "./CatalogResultsPresentation";

/**
 * Verifies list mode renders explanation-first readiness rows with the mode toggle visible.
 */
test("catalog results presentation renders list mode by default", () => {
  const html = renderToStaticMarkup(<CatalogResultsPresentation rows={[buildRow()]} />);

  assert.match(html, /List/u);
  assert.match(html, /Table/u);
  assert.match(html, /Review Needed/u);
  assert.match(html, /Top blocker/u);
  assert.match(html, /Connector intelligence/u);
  assert.match(html, /Verification steps/u);
});

/**
 * Verifies table mode renders the dense engineering table over the same real-ready row model.
 */
test("catalog results presentation renders dense table mode", () => {
  const html = renderToStaticMarkup(<CatalogResultsPresentation initialMode="table" rows={[buildRow()]} />);

  assert.match(html, /visible rows/u);
  assert.match(html, /Description/u);
  assert.match(html, /CAD\/export/u);
  assert.match(html, /Verification steps/u);
  assert.match(html, /Imp/u);
  assert.match(html, /Next action/u);
  assert.match(html, /Open/u);
  assert.match(html, /215079-8/u);
});

/**
 * Verifies the decision-point push: confirmed "bit us / blocked" memory interrupts in the
 * results, in both list and table modes, as a warning (not a gate).
 */
test("catalog results presentation surfaces prior engineering-memory warnings", () => {
  const row: CatalogResultRowViewModel = {
    ...buildRow(),
    memoryWarning: { blocking: false, count: 2, topTitle: "Bit us: contact backed out after thermal cycling" }
  };

  const listHtml = renderToStaticMarkup(<CatalogResultsPresentation rows={[row]} />);
  assert.match(listHtml, /Bit us before/u);
  assert.match(listHtml, /contact backed out after thermal cycling/u);
  assert.match(listHtml, /\+1 more/u);

  const tableHtml = renderToStaticMarkup(<CatalogResultsPresentation initialMode="table" rows={[row]} />);
  assert.match(tableHtml, /Prior memory/u);
  assert.match(tableHtml, /Bit us before \(2\)/u);
});

/**
 * Builds a deterministic row model for presentation tests.
 */
function buildRow(): CatalogResultRowViewModel {
  return {
    approvalDetail: "Open review work still remains before the record should be treated as approved.",
    approvalLabel: "Pending review",
    approvalTone: "info" as const,
    assetTruthDetail: "One generated asset still needs review.",
    assetTruthLabel: "Generated CAD present",
    cadExportLabel: "Export bundle: partial bundle",
    cadExportTone: "review" as const,
    category: "Connector",
    compareAddHref: "/compare?parts=part-1",
    description: "",
    connectorSignalDetail: "Mating set exists, but one accessory relationship still needs review.",
    connectorSignalLabel: "Mapped with follow-up",
    connectorSignalTitle: "Connector intelligence",
    connectorTitle: "Micro-Fit connector family",
    datasheetLabel: "File stored",
    datasheetTone: "verified" as const,
    exportLabel: "Export bundle: partial bundle",
    exportTone: "review" as const,
    href: "/parts/part-1",
    id: "part-1",
    lifecycleLabel: "Lifecycle: active",
    manufacturerName: "TE Connectivity",
    memoryWarning: null,
    mpn: "215079-8",
    nextActionDetail: "Review generated footprint before export.",
    nextActionLabel: "Review CAD",
    packageName: "Plug housing",
    riskLabel: "Top blocker",
    readinessDetail: "Identity is confirmed, but export still waits on verified file-backed assets.",
    readinessHeadline: "Review Needed",
    readinessSubhead: "One CAD workflow still needs engineering review.",
    topBlocker: "Review generated footprint before export.",
    trustLineageBadges: [
      { abbrev: "Imp", badgeTone: "verified", stageKey: "imported", stateMark: "OK", title: "Imported: ok." },
      { abbrev: "Rev", badgeTone: "neutral", stageKey: "reviewed", stateMark: "…", title: "Reviewed: pending." },
      { abbrev: "Apr", badgeTone: "info", stageKey: "approved", stateMark: "…", title: "Approved: pending." },
      { abbrev: "Exp", badgeTone: "review", stageKey: "verified_for_export", stateMark: "!", title: "Verified for export: blocked." }
    ],
    trustScore: 0.79,
    trustTone: "review" as const
  };
}
