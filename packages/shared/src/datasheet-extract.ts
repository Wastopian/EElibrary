/**
 * File header: Conservative heuristic extraction of canonical parameters from datasheet text.
 *
 * Datasheet PDFs are heterogeneous and flatten to messy text (no OCR, no table structure), so this
 * extractor is deliberately conservative: for each canonical parameter of the part's type it looks for
 * the registry label as an isolated word immediately followed by a parseable value, and emits at most
 * one value per parameter. It never guesses. Extracted values are a modest-confidence corroborating
 * source in reconciliation, never an override. Text-kind parameters (e.g. package) are intentionally
 * skipped -- those are reliably captured from distributor specs and are error-prone to read from prose.
 */

import { getParameterDefs } from "./parameter-registry";
import { parseEngineeringValue, type TypedParameterValue } from "./parameter-normalize";
import type { PartType } from "./part-type";

/** DatasheetExtractedParameter is one canonical parameter parsed from datasheet text. */
export interface DatasheetExtractedParameter {
  paramKey: string;
  typed: TypedParameterValue;
}

/** WINDOW_LENGTH bounds how far after a label we look for its value, keeping the first number the label's own. */
const WINDOW_LENGTH = 48;

/**
 * Extracts canonical numeric/range/enum parameters for a part type from datasheet text.
 */
export function extractDatasheetParameters(text: string, partType: PartType): DatasheetExtractedParameter[] {
  const normalized = collapseWhitespace(text);

  if (normalized.length === 0) {
    return [];
  }

  const results: DatasheetExtractedParameter[] = [];

  for (const def of getParameterDefs(partType)) {
    // Text/boolean params (package, etc.) are captured reliably from distributor specs; reading them
    // from datasheet prose is low-value and error-prone, so datasheet extraction skips them.
    if (def.valueKind === "text" || def.valueKind === "boolean") {
      continue;
    }

    for (const pattern of def.specKeyPatterns) {
      const window = findLabelWindow(normalized, pattern);

      if (window === null) {
        continue;
      }

      const typed = parseEngineeringValue(window, def);

      if (typed) {
        results.push({ paramKey: def.paramKey, typed });
        break;
      }
    }
  }

  return results;
}

/**
 * Returns the text window immediately after an isolated occurrence of a label, or null when absent.
 */
function findLabelWindow(text: string, pattern: string): string | null {
  // The label must be bounded by non-letters so "resistance" does not match inside another word and
  // "case" does not match inside "increase". Digits are allowed after (e.g. "power(w)").
  const re = new RegExp(`(?:^|[^a-z])${escapeRegExp(pattern)}(?![a-z])`, "iu");
  const match = re.exec(text);

  if (!match) {
    return null;
  }

  const start = match.index + match[0].length;

  return text.slice(start, start + WINDOW_LENGTH);
}

/**
 * Collapses whitespace so labels and values that span line breaks in the PDF text stay adjacent.
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Escapes regex metacharacters in a literal label pattern.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
