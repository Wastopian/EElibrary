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
 * Returns the candidates whose value appears in the datasheet text (case-, space-, and unit-tolerant).
 */
export function confirmDatasheetParameters(text: string, candidates: DatasheetConfirmationCandidate[]): DatasheetConfirmationCandidate[] {
  // Strip whitespace entirely so a value split across the PDF's layout (e.g. "10 K Ω") still matches a
  // compact form ("10kω"). Value search does not rely on adjacency, so this is safe.
  const haystack = text.toLowerCase().replace(/\s+/gu, "");

  if (haystack.length === 0) {
    return [];
  }

  return candidates.filter((candidate) => datasheetContainsValue(haystack, candidate));
}

/**
 * Reports whether any search form of a candidate's value appears in the (space-stripped) datasheet text.
 */
function datasheetContainsValue(haystack: string, candidate: DatasheetConfirmationCandidate): boolean {
  const forms = searchFormsFor(candidate);

  return forms.some((form) => form.length > 0 && haystack.includes(form));
}

/**
 * Builds the candidate search strings for one parameter value (already lowercased and space-free).
 */
function searchFormsFor(candidate: DatasheetConfirmationCandidate): string[] {
  if (candidate.valueKind === "enum" || candidate.valueKind === "text" || candidate.valueKind === "boolean") {
    const value = candidate.valueText?.trim().toLowerCase().replace(/\s+/gu, "");

    return value ? [value] : [];
  }

  if (candidate.valueKind === "numeric" && candidate.valueNumeric !== null) {
    return numericSearchForms(candidate.valueNumeric, candidate.unit);
  }

  return [];
}

/** UNIT_SEARCH_TOKENS lists the lowercased unit spellings a datasheet may use, per canonical unit. */
const UNIT_SEARCH_TOKENS: Record<string, string[]> = {
  "%": ["%"],
  A: ["a"],
  F: ["f", "farad"],
  H: ["h", "henry"],
  Hz: ["hz"],
  ohm: ["ω", "ohm", "ohms", "r"],
  ppm_per_c: ["ppm"],
  V: ["v"],
  W: ["w", "watt", "watts"]
};

/** SI_PREFIXES maps a scale factor to the lowercased prefix symbol a datasheet may print. */
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
 * Generates lowercased, space-free search forms for a numeric value in its canonical unit.
 *
 * Every form carries either an SI prefix letter or the unit token so a bare number (e.g. "1") can never
 * false-match arbitrary digits in the space-stripped haystack.
 */
function numericSearchForms(value: number, unit: string | null): string[] {
  const forms = new Set<string>();
  const unitTokens = unit ? UNIT_SEARCH_TOKENS[unit] ?? [] : [];
  const bases: Array<{ mantissa: string; prefix: string }> = [{ mantissa: formatNumber(value), prefix: "" }];

  const compact = compactSiForm(value);

  if (compact) {
    bases.push(compact);
  }

  for (const base of bases) {
    const prefixVariants = base.prefix ? [base.prefix] : SI_PREFIXES.find((entry) => entry.factor === 1)?.symbols ?? [""];

    for (const prefix of prefixVariants) {
      const stem = `${base.mantissa}${prefix}`;

      // A prefixed stem (e.g. "10k") is distinctive on its own; a bare number needs the unit.
      if (prefix) {
        forms.add(stem);
      }

      for (const token of unitTokens) {
        forms.add(`${stem}${token}`);
      }
    }
  }

  if (unit === "%") {
    forms.add(`±${formatNumber(value)}%`);
  }

  if (unit === "W") {
    const fraction = POWER_FRACTIONS[formatNumber(value)];

    if (fraction) {
      forms.add(`${fraction}w`);
    }

    if (value < 1) {
      forms.add(`${formatNumber(value * 1000)}mw`);
    }
  }

  return [...forms].map((form) => form.toLowerCase().replace(/\s+/gu, ""));
}

/**
 * Returns the compact SI mantissa/prefix for a value (mantissa in [1, 1000)), or null for zero.
 */
function compactSiForm(value: number): { mantissa: string; prefix: string } | null {
  if (value === 0) {
    return null;
  }

  const magnitude = Math.abs(value);

  for (const entry of SI_PREFIXES) {
    const mantissa = magnitude / entry.factor;

    if (mantissa >= 1 && mantissa < 1000) {
      const symbol = entry.symbols[0] ?? "";

      return { mantissa: formatNumber(Math.sign(value) * mantissa), prefix: symbol };
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
