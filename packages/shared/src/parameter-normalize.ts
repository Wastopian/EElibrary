/**
 * File header: Parses verbatim provider spec values into canonical units and reconciles multiple sources.
 *
 * This is the typed successor to the worker's display-only metric parser. It converts a raw provider
 * value ("10kOhms", "±1%", "1/10W", "-55°C ~ +125°C", "X7R") into a canonical base-unit value per the
 * parameter's registry definition, then reconciles the contributions from every source (distributor
 * specs today, datasheet extraction later) into a single winning value with an explicit conflict flag.
 * It deliberately does NOT touch the worker's existing `part_metrics` parser; this is a superset used
 * only by the normalized-parameter path so metric semantics stay unchanged.
 */

import type { CanonicalParameterDef } from "./parameter-registry";
import type { PartParameterSource, PartParameterValueKind } from "./types";

/** TypedParameterValue is one parsed value in the parameter's canonical unit. */
export type TypedParameterValue =
  | { kind: "numeric"; value: number; unit: string | null }
  | { kind: "range"; min: number; max: number; unit: string | null }
  | { kind: "enum" | "text" | "boolean"; text: string; unit: string | null };

/** ParameterContribution is one source's parsed value awaiting reconciliation. */
export interface ParameterContribution {
  providerId: string;
  sourceRecordId: string | null;
  rawSpecKey: string;
  rawValue: string;
  typed: TypedParameterValue;
  confidence: number;
}

/** ReconciledParameter is the single winning value plus every source's contribution. */
export interface ReconciledParameter {
  valueKind: PartParameterValueKind;
  valueNumeric: number | null;
  valueMin: number | null;
  valueMax: number | null;
  valueText: string | null;
  unit: string | null;
  isConflicted: boolean;
  confidenceScore: number;
  winningProviderId: string;
  winningSourceRecordId: string | null;
  sources: PartParameterSource[];
}

/**
 * DEFAULT_PARAMETER_TRUST_ORDER breaks ties only when two sources report the SAME confidence. Datasheet
 * is listed first so a reviewed datasheet value (confidence raised to a distributor's level) edges it,
 * but an unreviewed heuristic extraction stays below via its lower confidence (see reconcile note).
 */
export const DEFAULT_PARAMETER_TRUST_ORDER: readonly string[] = ["datasheet", "digikey", "mouser", "octopart", "jlcparts"];

/**
 * DATASHEET_EXTRACTION_CONFIDENCE is the modest confidence assigned to a heuristic datasheet extraction.
 * It sits below the distributor-spec confidence so an unreviewed datasheet value corroborates or flags a
 * conflict but never silently overrides a distributor value.
 */
export const DATASHEET_EXTRACTION_CONFIDENCE = 0.5;

/** RELATIVE_NUMERIC_TOLERANCE is the fraction two numeric values may differ before they count as a conflict. */
const RELATIVE_NUMERIC_TOLERANCE = 0.01;

/** ABSOLUTE_NUMERIC_EPSILON guards near-zero comparisons where a relative tolerance is meaningless. */
const ABSOLUTE_NUMERIC_EPSILON = 1e-9;

/** BARE_SI_PREFIX_MULTIPLIERS maps a unit-less SI prefix to its multiplier (case-sensitive m vs M). */
const BARE_SI_PREFIX_MULTIPLIERS: Record<string, number> = {
  "": 1,
  G: 1e9,
  K: 1_000,
  M: 1e6,
  T: 1e12,
  k: 1_000,
  m: 1e-3,
  n: 1e-9,
  p: 1e-12,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6
};

/**
 * Parses a unit-less engineering number such as "1k", "4.7u", "10M", or "220" into its base value.
 *
 * Used for parameter search inputs, where the unit is implied by the field (a resistance box already
 * means ohms) so the user types only the magnitude and an optional SI prefix. Case matters for the
 * ambiguous single letter: "m" is milli, "M" is mega -- the same rule the provider parser uses.
 */
export function parseBareEngineeringNumber(rawValue: string): number | null {
  const match = rawValue.trim().match(/^([+-]?\d*\.?\d+)\s*([pnuµμmkKMGT]?)$/u);

  if (!match?.[1]) {
    return null;
  }

  const base = Number(match[1]);

  if (!Number.isFinite(base)) {
    return null;
  }

  return base * (BARE_SI_PREFIX_MULTIPLIERS[match[2] ?? ""] ?? 1);
}

/**
 * Parses a raw provider value into the canonical typed value for a parameter, or null when unparseable.
 */
export function parseEngineeringValue(rawValue: string, def: CanonicalParameterDef): TypedParameterValue | null {
  const text = rawValue.trim();

  if (text.length === 0) {
    return null;
  }

  if (def.valueKind === "range") {
    const range = parseRange(text);

    return range ? { kind: "range", max: range.max, min: range.min, unit: def.unit } : null;
  }

  if (def.valueKind === "enum") {
    return { kind: "enum", text: normalizeEnumValue(text, def.enumValues ?? []), unit: def.unit };
  }

  if (def.valueKind === "text" || def.valueKind === "boolean") {
    return { kind: def.valueKind, text, unit: def.unit };
  }

  const value = parseNumericValue(text, def.unit);

  return value === null ? null : { kind: "numeric", unit: def.unit, value };
}

/** DISPLAY_SI_PREFIXES is the canonical single-symbol prefix ladder used to render a base-unit value. */
const DISPLAY_SI_PREFIXES: ReadonlyArray<{ factor: number; prefix: string }> = [
  { factor: 1e12, prefix: "T" },
  { factor: 1e9, prefix: "G" },
  { factor: 1e6, prefix: "M" },
  { factor: 1e3, prefix: "k" },
  { factor: 1, prefix: "" },
  { factor: 1e-3, prefix: "m" },
  { factor: 1e-6, prefix: "µ" },
  { factor: 1e-9, prefix: "n" },
  { factor: 1e-12, prefix: "p" }
];

/** SI_PREFIXABLE_UNITS are the canonical units an engineer expects in SI-prefixed form (10 kΩ, 100 nF, 64 kB). */
const SI_PREFIXABLE_UNITS = new Set(["ohm", "F", "H", "V", "A", "W", "Hz", "s", "B"]);

/** UNIT_DISPLAY_GLYPH maps a canonical unit to the glyph engineers read (only ohm needs translating). */
const UNIT_DISPLAY_GLYPH: Record<string, string> = {
  ohm: "Ω",
  "deg C": "°C",
  ppm_per_c: "ppm/°C"
};

/**
 * Formats a clean mantissa string: integers stay exact, decimals trim to ~4 significant figures without
 * floating-point noise or trailing zeros ("10" -> "10", "4.7000" -> "4.7", "0.1000" -> "0.1").
 */
function formatEngineeringMantissa(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return Number.parseFloat(value.toPrecision(4)).toString();
}

/**
 * Formats a base value as the unit-less engineering shorthand the parameter filter inputs accept
 * ("10k", "4.7u", "220", "100m"): the display inverse of {@link parseBareEngineeringNumber}, used to
 * derive typeable placeholder examples from real facet bounds.
 */
export function formatBareEngineeringNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }

  const magnitude = Math.abs(value);

  for (const { factor, prefix } of DISPLAY_SI_PREFIXES) {
    const mantissa = magnitude / factor;

    if (mantissa >= 1 && mantissa < 1000) {
      return `${formatEngineeringMantissa((value / magnitude) * mantissa)}${prefix}`;
    }
  }

  return formatEngineeringMantissa(value);
}

/**
 * Renders a base-unit numeric value in the engineering notation an EE reads: SI-prefixed with the proper
 * glyph for prefixable units (10000 ohm -> "10 kΩ", 1e-7 F -> "100 nF", 0.1 W -> "100 mW"), bare percent
 * ("1%"), or number-plus-unit for the rest ("125 °C"). The inverse of {@link parseBareEngineeringNumber}.
 */
export function formatEngineeringValue(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  if (unit === "%") {
    return `${formatEngineeringMantissa(value)}%`;
  }

  if (unit !== null && SI_PREFIXABLE_UNITS.has(unit)) {
    const glyph = UNIT_DISPLAY_GLYPH[unit] ?? unit;

    if (value === 0) {
      return `0 ${glyph}`;
    }

    const magnitude = Math.abs(value);

    for (const { factor, prefix } of DISPLAY_SI_PREFIXES) {
      const mantissa = magnitude / factor;

      if (mantissa >= 1 && mantissa < 1000) {
        return `${formatEngineeringMantissa((value / magnitude) * mantissa)} ${prefix}${glyph}`;
      }
    }

    // Outside the prefix ladder (e.g. sub-pico or tera-plus): clamp to the nearest extreme prefix.
    const clamp = magnitude >= 1 ? { factor: 1e12, prefix: "T" } : { factor: 1e-12, prefix: "p" };

    return `${formatEngineeringMantissa(value / clamp.factor)} ${clamp.prefix}${glyph}`;
  }

  const glyph = unit === null ? "" : (UNIT_DISPLAY_GLYPH[unit] ?? unit);

  return glyph.length > 0 ? `${formatEngineeringMantissa(value)} ${glyph}` : formatEngineeringMantissa(value);
}

/**
 * Reconciles multiple parsed contributions into one winning value with an explicit conflict flag.
 *
 * Winner precedence: higher parse confidence, then provider trust order. There is deliberately NO
 * datasheet-first override: an unreviewed heuristic datasheet extraction carries a modest confidence
 * (below a distributor spec), so it corroborates the distributor value when they agree and flags a
 * conflict when they disagree, but does not silently replace good distributor data. A datasheet value
 * still wins when it is the only source for a parameter (filling a gap) or, later, when a review raises
 * its confidence above the distributors'. A parameter is conflicted when any source disagrees with the
 * winner beyond tolerance.
 */
export function reconcileParameterSources(
  contributions: ParameterContribution[],
  trustOrder: readonly string[] = DEFAULT_PARAMETER_TRUST_ORDER
): ReconciledParameter | null {
  if (contributions.length === 0) {
    return null;
  }

  const trustIndex = (providerId: string): number => {
    const index = trustOrder.indexOf(providerId);

    return index === -1 ? trustOrder.length : index;
  };

  const ranked = [...contributions].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return trustIndex(left.providerId) - trustIndex(right.providerId);
  });

  const winner = ranked[0]!;
  const sources: PartParameterSource[] = ranked.map((contribution) => ({
    agreesWithWinner: typedValuesAgree(winner.typed, contribution.typed),
    confidence: contribution.confidence,
    providerId: contribution.providerId,
    rawSpecKey: contribution.rawSpecKey,
    rawValue: contribution.rawValue,
    sourceRecordId: contribution.sourceRecordId,
    valueMax: contribution.typed.kind === "range" ? contribution.typed.max : null,
    valueMin: contribution.typed.kind === "range" ? contribution.typed.min : null,
    valueNumeric: contribution.typed.kind === "numeric" ? contribution.typed.value : null,
    valueText: isTextKind(contribution.typed) ? contribution.typed.text : null
  }));

  return {
    confidenceScore: winner.confidence,
    isConflicted: sources.some((source) => !source.agreesWithWinner),
    sources,
    unit: winner.typed.unit,
    valueKind: winner.typed.kind,
    valueMax: winner.typed.kind === "range" ? winner.typed.max : null,
    valueMin: winner.typed.kind === "range" ? winner.typed.min : null,
    valueNumeric: winner.typed.kind === "numeric" ? winner.typed.value : null,
    valueText: isTextKind(winner.typed) ? winner.typed.text : null,
    winningProviderId: winner.providerId,
    winningSourceRecordId: winner.sourceRecordId
  };
}

/**
 * Reports whether two typed values agree closely enough not to count as a source conflict.
 */
function typedValuesAgree(winner: TypedParameterValue, candidate: TypedParameterValue): boolean {
  if (winner.kind !== candidate.kind) {
    return false;
  }

  if (winner.kind === "numeric" && candidate.kind === "numeric") {
    return numbersAgree(winner.value, candidate.value);
  }

  if (winner.kind === "range" && candidate.kind === "range") {
    return numbersAgree(winner.min, candidate.min) && numbersAgree(winner.max, candidate.max);
  }

  if (isTextKind(winner) && isTextKind(candidate)) {
    return winner.text.trim().toLowerCase() === candidate.text.trim().toLowerCase();
  }

  return false;
}

/**
 * Reports whether two numbers agree within relative tolerance (with a near-zero absolute guard).
 */
function numbersAgree(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right), ABSOLUTE_NUMERIC_EPSILON);

  return Math.abs(left - right) <= scale * RELATIVE_NUMERIC_TOLERANCE;
}

/** Narrows a typed value to the text-bearing kinds. */
function isTextKind(value: TypedParameterValue): value is { kind: "enum" | "text" | "boolean"; text: string; unit: string | null } {
  return value.kind === "enum" || value.kind === "text" || value.kind === "boolean";
}

/**
 * Matches a raw value against a parameter's allowed enum values case-insensitively, else keeps it verbatim.
 */
function normalizeEnumValue(text: string, enumValues: string[]): string {
  const normalized = text.trim().toLowerCase();
  const match = enumValues.find((candidate) => normalized.includes(candidate.toLowerCase()));

  return match ?? text.trim();
}

/**
 * Parses a two-ended range such as "-55°C ~ +125°C" or "-40 to 85" into ordered numeric bounds.
 */
function parseRange(text: string): { min: number; max: number } | null {
  const numbers = text.match(/[+-]?\d+(?:\.\d+)?/gu);

  if (!numbers || numbers.length < 2) {
    return null;
  }

  const first = Number(numbers[0]);
  const second = Number(numbers[1]);

  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  return { max: Math.max(first, second), min: Math.min(first, second) };
}

/**
 * Parses a numeric provider value into its canonical base unit, handling SI prefixes and W fractions.
 */
function parseNumericValue(text: string, unit: string | null): number | null {
  // Power ratings are commonly written as fractions, e.g. "1/10W" meaning 0.1 W.
  if (unit === "W") {
    const fraction = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/u);

    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);

      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return (numerator / denominator) * readMultiplier(text, unit);
      }
    }
  }

  const match = text.match(/([+-]?\d+(?:\.\d+)?)/u);

  if (!match?.[1]) {
    return null;
  }

  const parsed = Number(match[1]);

  return Number.isFinite(parsed) ? parsed * readMultiplier(text, unit) : null;
}

/**
 * Reads an SI-prefix multiplier for the canonical unit. This is a superset of the worker's metric
 * multiplier: it adds W, %, and ppm handling and preserves the ohm milli-vs-mega case-sensitivity exactly.
 */
function readMultiplier(text: string, unit: string | null): number {
  const normalized = text.trim().toLowerCase();

  if (unit === "ohm") {
    // A lone "m"/"M" next to Ohm is ambiguous: lowercase m is milli, uppercase M is mega. Match the
    // prefix letter directly against "ohm" (case-sensitive on the letter, case-insensitive on "ohm").
    if (/milliohms?|milli-ohms?/iu.test(text) || /m\s?[oO]hms?/u.test(text)) return 0.001;
    if (/kiloohms?/iu.test(text) || /[kK]\s?[oO]hms?/u.test(text)) return 1_000;
    if (/megohms?|megaohms?/iu.test(text) || /M\s?[oO]hms?/u.test(text)) return 1_000_000;
  }

  if (unit === "F") {
    if (/\bpf\b/u.test(normalized)) return 1e-12;
    if (/\bnf\b/u.test(normalized)) return 1e-9;
    if (/\b(uf|µf|microfarad)\b/u.test(normalized)) return 1e-6;
    if (/\b(mf|millifarad)\b/u.test(normalized)) return 1e-3;
  }

  if (unit === "H") {
    if (/\bph\b/u.test(normalized)) return 1e-12;
    if (/\bnh\b/u.test(normalized)) return 1e-9;
    if (/\b(uh|µh|microhenry)\b/u.test(normalized)) return 1e-6;
    if (/\b(mh|millihenry)\b/u.test(normalized)) return 1e-3;
  }

  // Prefixes are matched with (?<![a-z0-9]) rather than \b so attached provider forms parse too:
  // "200mA", "64MHz", "1.2mV" put a digit directly before the prefix letter, where \b never fires.
  if (unit === "V") {
    if (/(?<![a-z0-9])(uv|µv)\b/u.test(normalized)) return 1e-6;
    if (/(?<![a-z0-9])mv\b/u.test(normalized) || /\dmv\b/u.test(normalized)) return 1e-3;
    if (/(?<![a-z0-9])kv\b/u.test(normalized) || /\dkv\b/u.test(normalized)) return 1_000;
    if (/\d(uv|µv)\b/u.test(normalized)) return 1e-6;
  }

  if (unit === "A") {
    if (/(?<![a-z0-9])na\b/u.test(normalized) || /\dna\b/u.test(normalized)) return 1e-9;
    if (/(?<![a-z0-9])(ua|µa)\b/u.test(normalized) || /\d(ua|µa)\b/u.test(normalized)) return 1e-6;
    if (/(?<![a-z0-9])ma\b/u.test(normalized) || /\dma\b/u.test(normalized)) return 1e-3;
  }

  if (unit === "Hz") {
    if (/(?<![a-z0-9])khz\b/u.test(normalized) || /\dkhz\b/u.test(normalized)) return 1_000;
    if (/(?<![a-z0-9])mhz\b/u.test(normalized) || /\dmhz\b/u.test(normalized)) return 1_000_000;
    if (/(?<![a-z0-9])ghz\b/u.test(normalized) || /\dghz\b/u.test(normalized)) return 1_000_000_000;
  }

  if (unit === "B") {
    // Memory sizes ("64 Kbytes of Flash", "64KB", "1MB") use decimal SI here: the nominal figure is
    // the universal search/compare handle; the verbatim provider string stays available alongside.
    if (/(?<![a-z0-9])(kb|kbytes?)\b/u.test(normalized) || /\dkb\b/u.test(normalized)) return 1e3;
    if (/(?<![a-z0-9])(mb|mbytes?)\b/u.test(normalized) || /\dmb\b/u.test(normalized)) return 1e6;
    if (/(?<![a-z0-9])(gb|gbytes?)\b/u.test(normalized) || /\dgb\b/u.test(normalized)) return 1e9;
  }

  if (unit === "W") {
    // Milliwatt is common for chip resistors; kilowatt is rare but harmless. Megawatt is not a component
    // rating, so uppercase M is not treated as mega here.
    if (/\bmw\b/u.test(normalized) || /\dmw\b/u.test(normalized)) return 1e-3;
    if (/\bkw\b/u.test(normalized) || /\dkw\b/u.test(normalized)) return 1_000;
  }

  return 1;
}
