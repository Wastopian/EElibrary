/**
 * File header: Confirms a part's known distributor parameter values against its datasheet text.
 *
 * Blind extraction from datasheet PDFs does not work: a passive's datasheet is a generic *series*
 * datasheet (all sizes/tolerances), so it never states the specific part's value as a clean label:value
 * pair, and keyword-proximity parsing fabricates wrong numbers (e.g. reading reel diameters as power).
 * Instead this module works the other way around -- it takes the values a distributor already reports and
 * searches the datasheet text for each one, returning the subset that appears. A found value is a genuine
 * corroboration ("confirmed by datasheet"); a missing one is silent. It never invents a value and never
 * produces a conflict, so it can only raise trust, never poison it.
 *
 * Matching is deliberately strict to avoid false corroboration: each value is matched with an anchored,
 * whitespace-tolerant regex that requires the value's UNIT (so "1%" can never be read out of "0.1%", and
 * a 10 kOhm value can never match a "10 kV" mention) and a numeric boundary on both sides.
 */

import type { PartParameterValueKind } from "./types";

/** DatasheetConfirmationCandidate is one distributor parameter value to look for in the datasheet. */
export interface DatasheetConfirmationCandidate {
  paramKey: string;
  valueKind: PartParameterValueKind;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
}

/**
 * Returns the candidates whose value appears in the datasheet text (case-, spacing-, and unit-tolerant).
 */
export function confirmDatasheetParameters(text: string, candidates: DatasheetConfirmationCandidate[]): DatasheetConfirmationCandidate[] {
  // Collapse (do not strip) whitespace: the matchers allow optional spaces inside a value, so "10 K Ω"
  // and "10kΩ" both match while numeric boundaries stay meaningful.
  const haystack = text.toLowerCase().replace(/\s+/gu, " ").trim();

  if (haystack.length === 0) {
    return [];
  }

  return candidates.filter((candidate) => valueMatchers(candidate).some((matcher) => matcher.test(haystack)));
}

/** UNIT_MATCHERS maps a canonical unit to a regex fragment matching how a datasheet may spell it. */
const UNIT_MATCHERS: Record<string, string> = {
  "%": "%",
  A: "a",
  F: "(?:f|farads?)",
  H: "(?:h|henr(?:y|ies))",
  Hz: "(?:hz)",
  ohm: "(?:ω|ohms?)",
  ppm_per_c: "ppm",
  V: "v",
  W: "(?:w|watts?)"
};

/** SI_PREFIXES maps a scale factor to the lowercased prefix symbols a datasheet may print for it. */
const SI_PREFIXES: ReadonlyArray<{ factor: number; symbols: string[] }> = [
  { factor: 1e9, symbols: ["g"] },
  { factor: 1e6, symbols: ["m", "meg"] },
  { factor: 1e3, symbols: ["k"] },
  { factor: 1, symbols: [""] },
  { factor: 1e-3, symbols: ["m"] },
  { factor: 1e-6, symbols: ["u", "µ", "μ"] },
  { factor: 1e-9, symbols: ["n"] },
  { factor: 1e-12, symbols: ["p"] }
];

/** POWER_FRACTIONS maps common resistor power ratings to their datasheet fraction spelling. */
const POWER_FRACTIONS: Record<string, string> = {
  "0.0625": "1/16",
  "0.05": "1/20",
  "0.1": "1/10",
  "0.125": "1/8",
  "0.2": "1/5",
  "0.25": "1/4",
  "0.333": "1/3",
  "0.5": "1/2"
};

/**
 * Builds the anchored regex matchers for one candidate value.
 */
function valueMatchers(candidate: DatasheetConfirmationCandidate): RegExp[] {
  if (candidate.valueKind === "enum" || candidate.valueKind === "text" || candidate.valueKind === "boolean") {
    const value = candidate.valueText?.trim().toLowerCase();

    if (!value) {
      return [];
    }

    // A short code like "0603" must sit on its own, not inside a longer token (e.g. an MPN "rc0603fr").
    return [new RegExp(`(?<![a-z0-9])${escapeRegExp(value).replace(/\s+/gu, "\\s*")}(?![a-z0-9])`, "u")];
  }

  if (candidate.valueKind === "numeric" && candidate.valueNumeric !== null && Number.isFinite(candidate.valueNumeric)) {
    return numericMatchers(candidate.valueNumeric, candidate.unit);
  }

  return [];
}

/**
 * Builds anchored, whitespace-tolerant, unit-bearing matchers for a numeric value in its canonical unit.
 *
 * Every matcher requires the unit and a numeric boundary on each side, so a bare number can never
 * false-match arbitrary digits and a value can never be read out of a longer or differently-united one.
 */
function numericMatchers(value: number, unit: string | null): RegExp[] {
  const unitMatcher = unit ? UNIT_MATCHERS[unit] : undefined;

  if (!unitMatcher) {
    return [];
  }

  const matchers: RegExp[] = [];
  const add = (numberSource: string, prefixSource: string, unitSource: string): void => {
    matchers.push(new RegExp(`(?<![a-z0-9.])${numberSource}\\s*${prefixSource}\\s*${unitSource}(?![a-z0-9])`, "u"));
  };

  const mantissa = escapeRegExp(formatNumber(value));

  add(mantissa, "", unitMatcher);

  const compact = compactSiForm(value);

  if (compact) {
    const escapedMantissa = escapeRegExp(compact.mantissa);

    for (const symbol of compact.symbols) {
      add(escapedMantissa, escapeRegExp(symbol), unitMatcher);
    }
  }

  if (unit === "%") {
    // Allow a leading tolerance sign and an explicit ".0", e.g. "± 1.0 %".
    matchers.push(new RegExp(`(?<![a-z0-9.])[±+-]?\\s*${mantissa}(?:\\.0+)?\\s*%(?![a-z0-9])`, "u"));
  }

  if (unit === "W") {
    const fraction = POWER_FRACTIONS[formatNumber(value)];

    if (fraction) {
      const [numerator, denominator] = fraction.split("/");
      matchers.push(new RegExp(`(?<![a-z0-9.])${numerator}\\s*/\\s*${denominator}\\s*${unitMatcher}(?![a-z0-9])`, "u"));
    }

    if (value < 1) {
      add(escapeRegExp(formatNumber(value * 1000)), "m", unitMatcher);
    }
  }

  return matchers;
}

/**
 * Returns the compact SI mantissa/prefix symbols for a value (mantissa in [1, 1000)), or null for zero
 * and values outside the supported prefix range.
 */
function compactSiForm(value: number): { mantissa: string; symbols: string[] } | null {
  if (value === 0) {
    return null;
  }

  const magnitude = Math.abs(value);

  for (const entry of SI_PREFIXES) {
    if (entry.factor === 1) {
      continue;
    }

    const mantissa = magnitude / entry.factor;

    if (mantissa >= 1 && mantissa < 1000) {
      return { mantissa: formatNumber(Math.sign(value) * mantissa), symbols: entry.symbols };
    }
  }

  return null;
}

/**
 * Formats a number as a clean decimal string without floating-point noise or trailing zeros.
 */
function formatNumber(value: number): string {
  return Number.parseFloat(value.toPrecision(6)).toString();
}

/**
 * Escapes regex metacharacters in a literal fragment.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
