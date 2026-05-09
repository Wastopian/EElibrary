"use client";

/**
 * File header: Renders package dimensions with a millimeter / inch unit toggle.
 *
 * Source values are stored in millimeters; inches are derived locally for cross-discipline
 * mechanical-engineering readers, without changing the canonical metric storage.
 */

import React from "react";

/** PackageDimensionInput captures the canonical millimeter package values used by the toggle. */
export type PackageDimensionInput = {
  pinCount: number | null;
  pitchMm: number | null;
  bodyLengthMm: number | null;
  bodyWidthMm: number | null;
  bodyHeightMm: number | null;
};

/** DimensionUnit names the user-facing measurement system shown in the dimension grid. */
type DimensionUnit = "mm" | "in";

/**
 * Renders the package dimension grid with a small mm / in toggle for cross-discipline readers.
 */
export function PackageDimensions({ partPackage }: { partPackage: PackageDimensionInput }) {
  const [unit, setUnit] = React.useState<DimensionUnit>("mm");

  return (
    <div className="package-dimensions">
      <div className="package-dimensions__toolbar" role="group" aria-label="Dimension units">
        <button aria-pressed={unit === "mm"} onClick={() => setUnit("mm")} type="button">
          mm
        </button>
        <button aria-pressed={unit === "in"} onClick={() => setUnit("in")} type="button">
          in
        </button>
      </div>
      <dl className="dimension-grid">
        <div>
          <dt>Pins</dt>
          <dd className="ui-mono">{partPackage.pinCount?.toString() ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Pitch</dt>
          <dd className="ui-mono">{formatLength(partPackage.pitchMm, unit)}</dd>
        </div>
        <div>
          <dt>Body length</dt>
          <dd className="ui-mono">{formatLength(partPackage.bodyLengthMm, unit)}</dd>
        </div>
        <div>
          <dt>Body width</dt>
          <dd className="ui-mono">{formatLength(partPackage.bodyWidthMm, unit)}</dd>
        </div>
        <div>
          <dt>Body height</dt>
          <dd className="ui-mono">{formatLength(partPackage.bodyHeightMm, unit)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Formats a millimeter value in the chosen unit, leaving missing data explicit.
 */
function formatLength(valueMm: number | null, unit: DimensionUnit): string {
  if (valueMm === null) {
    return "Unknown";
  }

  if (unit === "in") {
    const inches = valueMm / 25.4;
    return `${roundTo(inches, 4)} in`;
  }

  return `${valueMm} mm`;
}

/**
 * Rounds a number to a fixed decimal precision, trimming trailing zeros for compact display.
 */
function roundTo(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toString();
}
