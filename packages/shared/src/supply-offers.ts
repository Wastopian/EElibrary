/**
 * File header: Defines shared constants for provider-neutral commercial snapshot freshness.
 */

import type { LowestSupplyPriceSummary, PartSupplyOfferSummary, SupplyOffering } from "./types";

/** SUPPLY_OFFER_STALE_AFTER_DAYS marks commercial snapshots as stale without hiding them. */
export const SUPPLY_OFFER_STALE_AFTER_DAYS = 14;

/** SUPPLY_OFFER_MISSING_FROM_PROVIDER_REASON records why an older offer left the active supply set. */
export const SUPPLY_OFFER_MISSING_FROM_PROVIDER_REASON = "missing_from_latest_provider_snapshot";

/** BuildPartSupplyOfferSummaryOptions controls deterministic freshness checks in tests. */
export interface BuildPartSupplyOfferSummaryOptions {
  /** Freshness window in days; defaults to the product-wide supply-offer window. */
  staleAfterDays?: number;
  /** Evaluation clock for stale/current splits; defaults to the current time. */
  now?: Date | number | string;
}

/**
 * Builds provider-neutral commercial summary signals for active offer snapshots.
 *
 * The summary is a merge/read model only: it never approves a supplier, never makes a
 * buying recommendation, and never upgrades canonical part readiness. It helps the UI
 * compare source-linked snapshots while preserving the "not live stock" boundary.
 */
export function buildPartSupplyOfferSummary(
  offers: SupplyOffering[],
  options: BuildPartSupplyOfferSummaryOptions = {}
): PartSupplyOfferSummary {
  const staleAfterDays = options.staleAfterDays ?? SUPPLY_OFFER_STALE_AFTER_DAYS;
  const now = toTimestamp(options.now ?? Date.now());
  const providerIds = new Set(offers.map((offer) => offer.providerId));
  const namedSuppliers = collectNamedSuppliers(offers);

  return {
    currentOfferCount: offers.filter((offer) => !isSupplyOfferStaleAt(offer.lastSeenAt, staleAfterDays, now)).length,
    inStockOfferCount: offers.filter(isInStockOffer).length,
    lastSeenAt: getLatestSeenAt(offers),
    lowestCurrentInStockUnitPrice: getLowestUnitPrice(offers.filter((offer) => isInStockOffer(offer) && !isSupplyOfferStaleAt(offer.lastSeenAt, staleAfterDays, now))),
    lowestUnitPrice: getLowestUnitPrice(offers),
    namedSupplierCount: namedSuppliers.size,
    offerCount: offers.length,
    providerCount: providerIds.size,
    providerSummaries: buildSupplyOfferProviderSummaries(offers, staleAfterDays, now),
    staleOfferCount: offers.filter((offer) => isSupplyOfferStaleAt(offer.lastSeenAt, staleAfterDays, now)).length
  };
}

/**
 * Reports whether one commercial snapshot is stale at a deterministic clock value.
 */
export function isSupplyOfferStaleAt(lastSeenAt: string, staleAfterDays: number = SUPPLY_OFFER_STALE_AFTER_DAYS, now: Date | number | string = Date.now()): boolean {
  const parsedLastSeenAt = Date.parse(lastSeenAt);
  const parsedNow = toTimestamp(now);

  if (!Number.isFinite(parsedLastSeenAt) || !Number.isFinite(parsedNow)) {
    return true;
  }

  return parsedNow - parsedLastSeenAt > staleAfterDays * 24 * 60 * 60 * 1000;
}

/**
 * Builds per-provider summary rows sorted by source count, freshness, and provider id.
 */
function buildSupplyOfferProviderSummaries(
  offers: SupplyOffering[],
  staleAfterDays: number,
  now: number
): PartSupplyOfferSummary["providerSummaries"] {
  const byProvider = new Map<string, SupplyOffering[]>();

  for (const offer of offers) {
    byProvider.set(offer.providerId, [...(byProvider.get(offer.providerId) ?? []), offer]);
  }

  return [...byProvider.entries()]
    .map(([providerId, providerOffers]) => ({
      currentOfferCount: providerOffers.filter((offer) => !isSupplyOfferStaleAt(offer.lastSeenAt, staleAfterDays, now)).length,
      inStockOfferCount: providerOffers.filter(isInStockOffer).length,
      lastSeenAt: getLatestSeenAt(providerOffers),
      lowestCurrentInStockUnitPrice: getLowestUnitPrice(providerOffers.filter((offer) => isInStockOffer(offer) && !isSupplyOfferStaleAt(offer.lastSeenAt, staleAfterDays, now))),
      lowestUnitPrice: getLowestUnitPrice(providerOffers),
      namedSupplierCount: collectNamedSuppliers(providerOffers).size,
      offerCount: providerOffers.length,
      providerId,
      staleOfferCount: providerOffers.filter((offer) => isSupplyOfferStaleAt(offer.lastSeenAt, staleAfterDays, now)).length
    }))
    .sort((left, right) =>
      right.currentOfferCount - left.currentOfferCount ||
      right.offerCount - left.offerCount ||
      timestampForSort(right.lastSeenAt) - timestampForSort(left.lastSeenAt) ||
      left.providerId.localeCompare(right.providerId)
    );
}

/**
 * Finds the newest last-seen timestamp across commercial snapshots.
 */
function getLatestSeenAt(offers: SupplyOffering[]): string | null {
  const timestamps = offers.map((offer) => Date.parse(offer.lastSeenAt)).filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

/**
 * Finds the lowest recorded unit price while preserving its provider and MOQ context.
 */
function getLowestUnitPrice(offers: SupplyOffering[]): LowestSupplyPriceSummary | null {
  const candidates = offers.flatMap((offer) =>
    offer.priceBreaks.map((priceBreak) => ({
      currencyCode: priceBreak.currencyCode,
      minQuantity: priceBreak.minQuantity,
      offeringId: offer.id,
      providerId: offer.providerId,
      supplierName: offer.supplierName,
      unitPrice: priceBreak.unitPrice
    }))
  );

  candidates.sort((left, right) =>
    left.unitPrice - right.unitPrice ||
    left.minQuantity - right.minQuantity ||
    left.providerId.localeCompare(right.providerId) ||
    left.offeringId.localeCompare(right.offeringId)
  );

  return candidates[0] ?? null;
}

/**
 * Counts named supplier/seller labels without treating missing labels as distinct suppliers.
 */
function collectNamedSuppliers(offers: SupplyOffering[]): Set<string> {
  const suppliers = new Set<string>();

  for (const offer of offers) {
    const normalized = offer.supplierName?.trim().toLowerCase();

    if (normalized) {
      suppliers.add(normalized);
    }
  }

  return suppliers;
}

/**
 * Checks whether a snapshot reports positive or unspecified in-stock inventory.
 */
function isInStockOffer(offer: SupplyOffering): boolean {
  return offer.inventoryStatus === "in_stock" && offer.inventoryQuantity !== 0;
}

/**
 * Converts supported clock inputs into milliseconds for deterministic stale checks.
 */
function toTimestamp(value: Date | number | string): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  return Date.parse(value);
}

/**
 * Gives null or malformed timestamps a deterministic oldest value during sorting.
 */
function timestampForSort(value: string | null): number {
  if (value === null) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
