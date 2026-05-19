/**
 * File header: Loads compare-page detail records from operator-entered identifiers.
 */

import { fetchPartDetail, fetchPartSearchEnvelope, isApiClientError } from "./api-client";
import type { PartDetailResponse, PartSearchRecord } from "@ee-library/shared/types";

/** ComparePageState separates usable compare data from setup failures. */
export type ComparePageState =
  | { details: PartDetailResponse[]; status: "ready" }
  | { code: string; message: string; status: "setup_required" };

/**
 * Loads compare detail records from internal ids or exact MPN tokens while preserving setup errors as page state.
 */
export async function loadComparePage(partIdentifiers: string[]): Promise<ComparePageState> {
  const details: PartDetailResponse[] = [];
  const seenPartIds = new Set<string>();

  try {
    for (const partIdentifier of partIdentifiers) {
      const detail = await fetchCompareDetailByIdentifier(partIdentifier);

      if (detail && !seenPartIds.has(detail.record.part.id)) {
        details.push(detail);
        seenPartIds.add(detail.record.part.id);
      }
    }

    return {
      details,
      status: "ready"
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so compare detail truth cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Resolves an operator-entered compare token without guessing when search returns ambiguous records.
 */
async function fetchCompareDetailByIdentifier(partIdentifier: string): Promise<PartDetailResponse | null> {
  const directDetail = await fetchPartDetail(partIdentifier);

  if (directDetail) {
    return directDetail;
  }

  const searchEnvelope = await fetchPartSearchEnvelope({
    query: partIdentifier,
    pageSize: 10
  });
  const exactMatches = searchEnvelope.data.filter((record) => isExactCompareIdentifierMatch(record, partIdentifier));

  if (exactMatches.length !== 1 || !exactMatches[0]) {
    return null;
  }

  return fetchPartDetail(exactMatches[0].part.id);
}

/**
 * Matches only exact internal ids or manufacturer part numbers so compare never auto-selects a fuzzy search result.
 */
function isExactCompareIdentifierMatch(record: PartSearchRecord, partIdentifier: string): boolean {
  const normalizedIdentifier = partIdentifier.trim().toLowerCase();

  return record.part.id.toLowerCase() === normalizedIdentifier || record.part.mpn.toLowerCase() === normalizedIdentifier;
}
