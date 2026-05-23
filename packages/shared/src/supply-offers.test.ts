/**
 * File header: Tests provider-neutral commercial snapshot summary and freshness helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildPartSupplyOfferSummary, isSupplyOfferStaleAt } from "./supply-offers";
import type { SupplyOffering } from "./types";

/**
 * Verifies the merged summary separates current, stale, provider, supplier, and in-stock signals.
 */
test("buildPartSupplyOfferSummary merges provider spread without approving procurement", () => {
  const summary = buildPartSupplyOfferSummary(
    [
      buildOffer({
        id: "offer-digikey-current",
        inventoryQuantity: 1200,
        lastSeenAt: "2026-05-20T00:00:00.000Z",
        priceBreaks: [
          { minQuantity: 1, unitPrice: 0.62 },
          { minQuantity: 100, unitPrice: 0.41 }
        ],
        providerId: "octopart",
        supplierName: "Digi-Key"
      }),
      buildOffer({
        id: "offer-mouser-current",
        inventoryQuantity: 800,
        lastSeenAt: "2026-05-19T00:00:00.000Z",
        priceBreaks: [{ minQuantity: 1, unitPrice: 0.48 }],
        providerId: "octopart",
        supplierName: "Mouser"
      }),
      buildOffer({
        id: "offer-local-stale",
        inventoryStatus: "unknown",
        lastSeenAt: "2026-04-01T00:00:00.000Z",
        priceBreaks: [{ minQuantity: 1, unitPrice: 0.2 }],
        providerId: "local-catalog",
        supplierName: null
      })
    ],
    { now: "2026-05-23T00:00:00.000Z", staleAfterDays: 14 }
  );

  assert.equal(summary.offerCount, 3);
  assert.equal(summary.currentOfferCount, 2);
  assert.equal(summary.staleOfferCount, 1);
  assert.equal(summary.providerCount, 2);
  assert.equal(summary.namedSupplierCount, 2);
  assert.equal(summary.inStockOfferCount, 2);
  assert.equal(summary.lowestUnitPrice?.offeringId, "offer-local-stale");
  assert.equal(summary.lowestCurrentInStockUnitPrice?.offeringId, "offer-digikey-current");
  assert.equal(summary.providerSummaries[0]?.providerId, "octopart");
  assert.equal(summary.providerSummaries[0]?.currentOfferCount, 2);
  assert.equal(summary.providerSummaries[0]?.namedSupplierCount, 2);
});

/**
 * Verifies stale checks use a supplied clock so tests and API summaries stay deterministic.
 */
test("isSupplyOfferStaleAt evaluates commercial snapshot freshness at a fixed clock", () => {
  assert.equal(isSupplyOfferStaleAt("2026-05-15T00:00:00.000Z", 14, "2026-05-23T00:00:00.000Z"), false);
  assert.equal(isSupplyOfferStaleAt("2026-05-01T00:00:00.000Z", 14, "2026-05-23T00:00:00.000Z"), true);
  assert.equal(isSupplyOfferStaleAt("not-a-date", 14, "2026-05-23T00:00:00.000Z"), true);
});

/**
 * Builds a supply offering fixture with one default price tier.
 */
function buildOffer(overrides: Partial<Omit<SupplyOffering, "priceBreaks">> & {
  priceBreaks?: Array<{ minQuantity: number; unitPrice: number }>;
} = {}): SupplyOffering {
  const id = overrides.id ?? "offer-default";
  const providerId = overrides.providerId ?? "octopart";

  return {
    createdAt: "2026-05-01T00:00:00.000Z",
    currencyCode: "USD",
    id,
    inventoryQuantity: overrides.inventoryQuantity ?? 100,
    inventoryStatus: overrides.inventoryStatus ?? "in_stock",
    lastSeenAt: overrides.lastSeenAt ?? "2026-05-20T00:00:00.000Z",
    leadTimeDays: overrides.leadTimeDays ?? 3,
    moq: overrides.moq ?? 1,
    packaging: overrides.packaging ?? "Cut tape",
    partId: overrides.partId ?? "part-alpha",
    preferredRank: overrides.preferredRank ?? 1,
    priceBreaks: (overrides.priceBreaks ?? [{ minQuantity: 1, unitPrice: 0.5 }]).map((breakpoint) => ({
      capturedAt: "2026-05-20T00:00:00.000Z",
      currencyCode: "USD",
      id: `price-${id}-${breakpoint.minQuantity}`,
      minQuantity: breakpoint.minQuantity,
      supplyOfferingId: id,
      unitPrice: breakpoint.unitPrice
    })),
    providerId,
    providerPartKey: overrides.providerPartKey ?? "ABC-123",
    providerSku: overrides.providerSku ?? null,
    sourceRecordId: overrides.sourceRecordId ?? `source-${id}`,
    sourceUrl: overrides.sourceUrl ?? null,
    supplierName: overrides.supplierName === undefined ? "Digi-Key" : overrides.supplierName,
    updatedAt: "2026-05-20T00:00:00.000Z"
  };
}
