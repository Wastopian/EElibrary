/**
 * File header: Heuristic that decides whether a search query looks like an exact manufacturer
 * part number versus a vague engineering keyword. The catalog UI uses this to gate the
 * "Import exact MPN" call to action so generic searches do not trigger speculative imports.
 */

/** ExactMpnHeuristicReason names the rejection reason for diagnostics and tests. */
export type ExactMpnHeuristicReason =
  | "ok"
  | "empty"
  | "too_short"
  | "contains_whitespace"
  | "invalid_characters"
  | "missing_digit"
  | "missing_letter";

/** EXACT_MPN_MIN_LENGTH is the minimum length we will treat as a real MPN. */
export const EXACT_MPN_MIN_LENGTH = 5;

/**
 * Returns whether the trimmed query looks like an exact manufacturer part number.
 * The shape is intentionally strict: the import path must not run on vague keywords.
 */
export function looksLikeExactMpn(query: string | undefined | null): boolean {
  return classifyExactMpn(query).reason === "ok";
}

/**
 * Returns a structured classification so callers (or tests) can explain why a value
 * was treated as a vague query rather than an exact MPN.
 */
export function classifyExactMpn(query: string | undefined | null): { value: string; reason: ExactMpnHeuristicReason } {
  const value = (query ?? "").trim();

  if (value.length === 0) {
    return { reason: "empty", value };
  }

  if (/\s/u.test(value)) {
    return { reason: "contains_whitespace", value };
  }

  if (value.length < EXACT_MPN_MIN_LENGTH) {
    return { reason: "too_short", value };
  }

  if (!/^[A-Za-z0-9-]+$/u.test(value)) {
    return { reason: "invalid_characters", value };
  }

  if (!/[0-9]/u.test(value)) {
    return { reason: "missing_digit", value };
  }

  if (!/[A-Za-z]/u.test(value)) {
    return { reason: "missing_letter", value };
  }

  return { reason: "ok", value };
}

/**
 * Normalizes a query for exact MPN comparisons. Returns null when the query does not
 * look like an exact MPN.
 */
export function normalizeExactMpn(query: string | undefined | null): string | null {
  const classification = classifyExactMpn(query);
  return classification.reason === "ok" ? classification.value.toUpperCase() : null;
}
