/**
 * File header: Provides deterministic provider payload normalization helpers.
 */

import type { AssetState, LifecycleStatus, MetricUnit } from "./types";

/** metricUnitAliases maps provider spellings into internal normalized units. */
const metricUnitAliases = new Map<string, MetricUnit>([
  ["a", "A"],
  ["amp", "A"],
  ["amps", "A"],
  ["ampere", "A"],
  ["amperes", "A"],
  ["c", "deg C"],
  ["deg c", "deg C"],
  ["degree c", "deg C"],
  ["degrees c", "deg C"],
  ["f", "F"],
  ["farad", "F"],
  ["farads", "F"],
  ["h", "H"],
  ["henry", "H"],
  ["henrys", "H"],
  ["hz", "Hz"],
  ["mm", "mm"],
  ["millimeter", "mm"],
  ["millimeters", "mm"],
  ["ohm", "ohm"],
  ["ohms", "ohm"],
  ["v", "V"],
  ["volt", "V"],
  ["volts", "V"]
]);

/** lifecycleAliases maps provider lifecycle spellings into internal values. */
const lifecycleAliases = new Map<string, LifecycleStatus>([
  ["active", "active"],
  ["in production", "active"],
  ["not recommended", "not_recommended"],
  ["not recommended for new designs", "not_recommended"],
  ["nrnd", "not_recommended"],
  ["obsolete", "obsolete"],
  ["unknown", "unknown"]
]);

/** assetStateAliases maps provider asset state spellings into the internal state machine. */
const assetStateAliases = new Map<string, AssetState>([
  ["downloaded", "downloaded"],
  ["failed", "failed"],
  ["missing", "missing"],
  ["referenced", "referenced"],
  ["validated", "validated"]
]);

/**
 * Normalizes provider lifecycle text into the canonical lifecycle status.
 */
export function normalizeLifecycleStatus(value: string | null | undefined): LifecycleStatus {
  if (!value) {
    return "unknown";
  }

  return lifecycleAliases.get(value.trim().toLowerCase()) ?? "unknown";
}

/**
 * Normalizes provider unit text into the internal unit policy.
 */
export function normalizeMetricUnit(value: string): MetricUnit {
  const unit = metricUnitAliases.get(value.trim().toLowerCase());

  if (!unit) {
    throw new Error(`Unsupported metric unit: ${value}`);
  }

  return unit;
}

/**
 * Normalizes provider asset state text into the internal state machine.
 */
export function normalizeAssetState(value: string | null | undefined): AssetState {
  if (!value) {
    return "missing";
  }

  return assetStateAliases.get(value.trim().toLowerCase()) ?? "missing";
}

/**
 * Normalizes numeric provider values while preserving unknown values as null.
 */
export function normalizeNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Unsupported numeric value: ${value}`);
  }

  return parsed;
}
