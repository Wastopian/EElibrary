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
 * DEFAULT_PARAMETER_TRUST_ORDER ranks sources when confidence ties. Datasheet extraction (a later phase)
 * is deliberately first so, once present, it wins over distributor specs.
 */
export const DEFAULT_PARAMETER_TRUST_ORDER: readonly string[] = ["datasheet", "digikey", "mouser", "octopart", "jlcparts"];

/** RELATIVE_NUMERIC_TOLERANCE is the fraction two numeric values may differ before they count as a conflict. */
const RELATIVE_NUMERIC_TOLERANCE = 0.01;

/** ABSOLUTE_NUMERIC_EPSILON guards near-zero comparisons where a relative tolerance is meaningless. */
const ABSOLUTE_NUMERIC_EPSILON = 1e-9;

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

/**
 * Reconciles multiple parsed contributions into one winning value with an explicit conflict flag.
 *
 * Winner precedence: datasheet source first, then higher parse confidence, then provider trust order.
 * A parameter is conflicted when any source disagrees with the winner beyond tolerance.
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
    const leftDatasheet = left.providerId === "datasheet" ? 0 : 1;
    const rightDatasheet = right.providerId === "datasheet" ? 0 : 1;

    if (leftDatasheet !== rightDatasheet) {
      return leftDatasheet - rightDatasheet;
    }

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

  if (unit === "V") {
    if (/\b(uv|µv)\b/u.test(normalized)) return 1e-6;
    if (/\bmv\b/u.test(normalized)) return 1e-3;
    if (/\bkv\b/u.test(normalized)) return 1_000;
  }

  if (unit === "A") {
    if (/\b(na)\b/u.test(normalized)) return 1e-9;
    if (/\b(ua|µa)\b/u.test(normalized)) return 1e-6;
    if (/\bma\b/u.test(normalized)) return 1e-3;
  }

  if (unit === "Hz") {
    if (/\bkhz\b/u.test(normalized)) return 1_000;
    if (/\bmhz\b/u.test(normalized)) return 1_000_000;
    if (/\bghz\b/u.test(normalized)) return 1_000_000_000;
  }

  if (unit === "W") {
    // Milliwatt is common for chip resistors; kilowatt is rare but harmless. Megawatt is not a component
    // rating, so uppercase M is not treated as mega here.
    if (/\bmw\b/u.test(normalized) || /\dmw\b/u.test(normalized)) return 1e-3;
    if (/\bkw\b/u.test(normalized) || /\dkw\b/u.test(normalized)) return 1_000;
  }

  return 1;
}
