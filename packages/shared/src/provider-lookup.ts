/**
 * File header: Shares exact provider-lookup heuristics across API validation and web no-match UI gating.
 */

/**
 * Returns whether the lookup is concrete enough for explicit exact provider lookup.
 */
export function looksLikeConcreteProviderLookupQuery(query: string): boolean {
  const normalizedQuery = query.trim();
  const hasDigits = /[0-9]/u.test(normalizedQuery);
  const hasLetters = /[A-Za-z]/u.test(normalizedQuery);
  const hasWhitespace = /\s/u.test(normalizedQuery);

  if (
    normalizedQuery.length < 3 ||
    hasWhitespace ||
    !/^[A-Za-z0-9._/+:-]+$/u.test(normalizedQuery) ||
    !hasDigits
  ) {
    return false;
  }

  if (looksLikeGenericPackageLookupQuery(normalizedQuery)) {
    return false;
  }

  if (!hasLetters) {
    return normalizedQuery.length >= 6;
  }

  return true;
}

/**
 * Blocks common package and filter shorthands so exact provider lookup does not become package search.
 */
export function looksLikeGenericPackageLookupQuery(query: string): boolean {
  const normalizedQuery = query.trim().toUpperCase();

  return /^(?:QFN|SOIC|DFN|TSSOP|SOT)-?\d+(?:-\d+)?$/u.test(normalizedQuery);
}
