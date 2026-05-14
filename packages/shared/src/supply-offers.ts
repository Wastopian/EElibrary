/**
 * File header: Defines shared constants for provider-neutral commercial snapshot freshness.
 */

/** SUPPLY_OFFER_STALE_AFTER_DAYS marks commercial snapshots as stale without hiding them. */
export const SUPPLY_OFFER_STALE_AFTER_DAYS = 14;

/** SUPPLY_OFFER_MISSING_FROM_PROVIDER_REASON records why an older offer left the active supply set. */
export const SUPPLY_OFFER_MISSING_FROM_PROVIDER_REASON = "missing_from_latest_provider_snapshot";
