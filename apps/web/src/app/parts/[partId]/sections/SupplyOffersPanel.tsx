/**
 * File header: Renders source-linked commercial snapshots without treating them as
 * live stock or approval.
 */

import { EmptyState, StatusBadge } from "@ee-library/ui";
import React from "react";
import type { SupplyOffering } from "@ee-library/shared/types";
import {
  formatDateTime,
  formatInteger,
  formatInventoryStatus,
  formatPriceBreak,
  formatSupplyPrice,
  formatSupplySourceLabel,
  formatSupplyTerms,
  getBestPriceBreak,
  isSupplyOfferStale
} from "../lib/format";
import { inventoryStatusTone } from "../lib/tone";
import type { PartSupplyOffersState } from "../lib/types";

/**
 * Renders source-linked commercial snapshots without treating them as live stock or approval.
 */
export function SupplyOffersPanel({ state }: { state: PartSupplyOffersState }) {
  if (state.status === "unavailable") {
    return (
      <EmptyState
        body={`Supply snapshots require the database-backed catalog. ${state.message}`}
        title="Supply offers unavailable"
      />
    );
  }

  if (state.status === "not_found") {
    return (
      <EmptyState
        body="The detail source did not return a catalog part identity for this supply-offer request."
        title="No distributor offers recorded"
      />
    );
  }

  if (state.response.offers.length === 0) {
    return (
      <EmptyState
        body="No source-record-linked distributor offers are recorded for this part yet. Run a provider import that captures commercial snapshots before using this workspace for sourcing decisions."
        title="No distributor offers recorded"
      />
    );
  }

  const { response } = state;
  const { summary } = response;

  return (
    <div className="supply-offers-panel">
      <p className="document-control-panel__boundary">
        <strong>Commercial snapshot.</strong> {response.boundary}
      </p>

      <div className="detail-sourcing-grid" style={{ marginBottom: 12 }}>
        <div>
          <span>Recorded offers</span>
          <strong>{summary.offerCount}</strong>
          <p>{summary.inStockOfferCount} in-stock snapshot{summary.inStockOfferCount === 1 ? "" : "s"} recorded.</p>
        </div>
        <div>
          <span>Lowest price tier</span>
          <strong>{summary.lowestUnitPrice ? formatSupplyPrice(summary.lowestUnitPrice.unitPrice, summary.lowestUnitPrice.currencyCode) : "No price tiers"}</strong>
          <p>{summary.lowestUnitPrice ? `${formatSupplySourceLabel(summary.lowestUnitPrice)} at ${summary.lowestUnitPrice.minQuantity}+ units.` : "No provider price breaks are attached yet."}</p>
        </div>
        <div>
          <span>Freshness</span>
          <strong>{summary.lastSeenAt ? formatDateTime(summary.lastSeenAt) : "Not seen"}</strong>
          <p>{summary.staleOfferCount} offer{summary.staleOfferCount === 1 ? "" : "s"} older than {response.staleAfterDays} days.</p>
        </div>
      </div>

      <div className="ui-table-wrap">
        <table className="ui-table supply-offers-table">
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Availability</th>
              <th scope="col">Terms</th>
              <th scope="col">Price break</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {response.offers.map((offer) => (
              <SupplyOfferRow key={offer.id} offer={offer} staleAfterDays={response.staleAfterDays} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders one supply-offer row with source and freshness context.
 */
function SupplyOfferRow({ offer, staleAfterDays }: { offer: SupplyOffering; staleAfterDays: number }) {
  const bestBreak = getBestPriceBreak(offer.priceBreaks);
  const supplierLabel = formatSupplySourceLabel(offer);

  return (
    <tr>
      <td>
        <strong>{supplierLabel}</strong>
        <p>{offer.supplierName ? `via ${offer.providerId}` : `Provider ${offer.providerId}`}</p>
        <p>{offer.providerSku ? `SKU ${offer.providerSku}` : `Provider key ${offer.providerPartKey}`}</p>
        {offer.sourceUrl ? <a href={offer.sourceUrl}>Source record</a> : <span className="muted-copy">No source URL</span>}
      </td>
      <td>
        <StatusBadge label={formatInventoryStatus(offer.inventoryStatus)} tone={inventoryStatusTone(offer.inventoryStatus)} />
        <p>{offer.inventoryQuantity === null ? "Quantity not captured" : `${formatInteger(offer.inventoryQuantity)} available`}</p>
      </td>
      <td>
        <strong>{formatSupplyTerms(offer)}</strong>
        <p>{offer.packaging ?? "Packaging not captured"}{offer.preferredRank ? ` / preferred rank ${offer.preferredRank}` : ""}</p>
      </td>
      <td>
        <strong>{bestBreak ? formatPriceBreak(bestBreak) : "No price tier"}</strong>
        <p>{offer.priceBreaks.length > 1 ? `${offer.priceBreaks.length} tiers captured` : "Single or no tier captured"}</p>
      </td>
      <td>
        <StatusBadge label={isSupplyOfferStale(offer.lastSeenAt, staleAfterDays) ? "Stale" : "Current"} tone={isSupplyOfferStale(offer.lastSeenAt, staleAfterDays) ? "review" : "info"} />
        <p>{formatDateTime(offer.lastSeenAt)}</p>
      </td>
    </tr>
  );
}
