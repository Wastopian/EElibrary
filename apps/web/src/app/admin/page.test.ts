/**
 * File header: Tests admin workspace rendering for review, promotion, and audit operations.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPartRecords } from "@ee-library/shared/search";
import AdminPage from "./page";
import type { PartSearchRecord } from "@ee-library/shared/types";

/**
 * Verifies setup-required admin rendering remains explicit when DB-backed catalog data is unavailable.
 */
test("admin workspace renders setup guidance when DB-backed catalog is unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "not_configured",
          objectStorage: "not_connected_phase_0",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    return jsonResponse(
      {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Catalog database is not configured."
        }
      },
      503
    );
  });

  try {
    const html = await renderAdminPage();

    assert.match(html, /Admin workspace/u);
    assert.match(html, /Setup guidance/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.match(html, /EE_LIBRARY_ALLOW_SEED_FALLBACK/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies admin workspace exposes review queue, promotion queue, and audit sections with actionable states.
 */
test("admin workspace renders review, promotion, import, validation, and audit sections", async () => {
  const records = buildAdminFixtureRecords();
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "connected",
          objectStorage: "connected_phase_0",
          queue: "connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    return jsonResponse({
      data: records,
      source: "database",
      warnings: []
    });
  });

  try {
    const html = await renderAdminPage();

    assert.match(html, /Import by MPN/u);
    assert.match(html, /Operator import/u);
    assert.match(html, /Grouped by real review, promotion, import, and validation state/u);
    assert.match(html, /Duplicate candidates/u);
    assert.match(html, /Obsolescence risk/u);
    assert.match(html, /Unresolved mating parts/u);
    assert.match(html, /Unavailable/u);
    assert.match(html, /Review queue/u);
    assert.match(html, /Promotion queue/u);
    assert.match(html, /Recent imports/u);
    assert.match(html, /Validation evidence summary/u);
    assert.match(html, /Promotion audit history/u);
    assert.match(html, /pending review/u);
    assert.match(html, /Eligible now/u);
    assert.match(html, /Blocked/u);
    assert.match(html, /Failed imports/u);
    assert.match(html, /Generated draft requires explicit review outcome/u);
  } finally {
    restoreFetch();
  }
});

async function renderAdminPage(): Promise<string> {
  return renderToStaticMarkup(await AdminPage());
}

function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}

function buildAdminFixtureRecords(): PartSearchRecord[] {
  const records = structuredClone(getAllPartRecords()) as PartSearchRecord[];
  const promotableRecord = records.find((record) => record.assets.some((asset) => asset.assetType === "footprint"));
  const blockedRecord = records.find((record) => record.assets.some((asset) => asset.assetType === "symbol")) ?? records[0];
  const reviewRecord = records.find((record) => record.assets.some((asset) => asset.provenance === "generated")) ?? records[0];

  if (!promotableRecord || !blockedRecord || !reviewRecord) {
    return records;
  }

  const promotableAsset = promotableRecord.assets.find((asset) => asset.assetType === "footprint") ?? promotableRecord.assets[0];
  const promotableAssetId = promotableAsset?.id ?? "";
  const blockedAsset = blockedRecord.assets.find((asset) => asset.id !== promotableAssetId && asset.assetType !== "datasheet") ?? blockedRecord.assets[0];
  const reviewAsset = reviewRecord.assets.find((asset) => asset.provenance === "generated") ?? reviewRecord.assets[0];

  if (!promotableAsset || !blockedAsset || !reviewAsset) {
    return records;
  }

  promotableAsset.assetState = "downloaded";
  promotableAsset.assetStatus = "reviewed";
  promotableAsset.availabilityStatus = "downloaded";
  promotableAsset.exportStatus = "not_exportable";
  promotableAsset.fileHash = "sha256:admin-promotable";
  promotableAsset.licenseMode = "redistribution_allowed";
  promotableAsset.reviewStatus = "approved";
  promotableAsset.storageKey = "assets/admin/promotable-footprint";
  promotableAsset.validationStatus = "verified";
  promotableRecord.validationRecords = promotableRecord.validationRecords.filter((record) => record.assetId !== promotableAsset.id);
  promotableRecord.validationRecords.push({
    assetId: promotableAsset.id,
    id: "validation-admin-promotable",
    lastUpdatedAt: "2026-04-15T00:00:00.000Z",
    partId: promotableRecord.part.id,
    validatedAt: "2026-04-15T00:00:00.000Z",
    validationNotes: "Admin fixture qualifying evidence.",
    validationStatus: "verified",
    validationType: "footprint_geometry",
    validator: "admin-fixture"
  });

  blockedAsset.assetState = "downloaded";
  blockedAsset.assetStatus = "reviewed";
  blockedAsset.availabilityStatus = "downloaded";
  blockedAsset.exportStatus = "not_exportable";
  blockedAsset.fileHash = "sha256:admin-blocked";
  blockedAsset.licenseMode = "redistribution_allowed";
  blockedAsset.reviewStatus = "approved";
  blockedAsset.storageKey = "assets/admin/blocked";
  blockedAsset.validationStatus = "needs_review";
  blockedRecord.validationRecords = blockedRecord.validationRecords.filter((record) => record.assetId !== blockedAsset.id);

  reviewAsset.assetState = "downloaded";
  reviewAsset.assetStatus = "downloaded";
  reviewAsset.availabilityStatus = "downloaded";
  reviewAsset.exportStatus = "not_exportable";
  reviewAsset.provenance = "generated";
  reviewAsset.reviewStatus = "review_required";
  reviewAsset.validationStatus = "needs_review";
  reviewAsset.storageKey = reviewAsset.storageKey ?? "assets/admin/generated-review";
  reviewAsset.fileHash = reviewAsset.fileHash ?? "sha256:admin-generated-review";

  const firstSource = reviewRecord.sources[0];
  if (firstSource) {
    firstSource.importStatus = "failed";
    firstSource.importErrorDetails = "Fixture import failure for admin queue test.";
  }

  return records;
}
