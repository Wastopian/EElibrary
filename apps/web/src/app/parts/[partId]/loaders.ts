/**
 * File header: Server-side data loaders for the part detail page.
 *
 * Each loader returns a discriminated state union so the page can still render
 * detail truth even when side-channel reads (where-used, supply offers,
 * document control, audit events) are degraded.
 */

import {
  fetchEntityAuditEvents,
  fetchPartDetailEnvelope,
  fetchPartDocumentRevisions,
  fetchPartSupplyOffers,
  fetchPartWhereUsed,
  isApiClientError
} from "../../../lib/api-client";
import type { AuditEvent } from "@ee-library/shared/types";
import type {
  PartDetailPageState,
  PartDocumentControlState,
  PartSupplyOffersState,
  PartWhereUsedState
} from "./lib/types";

/**
 * Loads the main part detail payload while keeping side-channel reads recoverable.
 */
export async function loadPartDetailPage(partId: string): Promise<PartDetailPageState> {
  const whereUsedPromise = loadPartWhereUsed(partId);
  const supplyOffersPromise = loadPartSupplyOffers(partId);

  try {
    const detailEnvelope = await fetchPartDetailEnvelope(partId);

    if (!detailEnvelope) {
      return { status: "not_found" };
    }

    const detail = detailEnvelope.data;
    const [whereUsedState, documentControlState, supplyOffersState] = await Promise.all([
      whereUsedPromise,
      loadPartDocumentControl(partId),
      supplyOffersPromise
    ]);

    return {
      detail,
      documentControlState,
      source: detailEnvelope.source,
      status: "ready",
      supplyOffersState,
      whereUsedState
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        partId,
        status: "setup_required",
        whereUsedState: await whereUsedPromise
      };
    }

    return {
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so catalog detail truth cannot be read.",
      partId,
      status: "setup_required",
      whereUsedState: await whereUsedPromise
    };
  }
}

/**
 * Loads where-used history as a recoverable side-channel so detail truth can still render.
 */
export async function loadPartWhereUsed(partId: string): Promise<PartWhereUsedState> {
  try {
    const response = await fetchPartWhereUsed(partId);

    return response ? { response, status: "available" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "unavailable"
      };
    }

    return {
      code: "WHERE_USED_UNAVAILABLE",
      message: "Where-used history could not be read from projects.",
      status: "unavailable"
    };
  }
}

/**
 * Loads supply offer snapshots as a recoverable side-channel so detail truth stays renderable.
 */
export async function loadPartSupplyOffers(partId: string): Promise<PartSupplyOffersState> {
  try {
    const response = await fetchPartSupplyOffers(partId);

    return response ? { response, status: "available" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "unavailable"
      };
    }

    return {
      code: "SUPPLY_OFFERS_UNAVAILABLE",
      message: "Supply offer snapshots could not be read from the catalog.",
      status: "unavailable"
    };
  }
}

/**
 * Loads the last few audit events for this part so detail pages can render a compact
 * "Recent activity" strip. Auditing is admin-gated; for non-admin sessions or any
 * transport failure the helper returns null so the page renders without a strip.
 */
export async function loadRecentActivityForPart(partId: string): Promise<AuditEvent[] | null> {
  const response = await fetchEntityAuditEvents("part", partId, 5);
  return response ? response.events : null;
}

/**
 * Loads document-control history as a recoverable side-channel for part detail.
 */
export async function loadPartDocumentControl(partId: string): Promise<PartDocumentControlState> {
  try {
    const response = await fetchPartDocumentRevisions(partId);

    return response ? { response, status: "available" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "unavailable"
      };
    }

    return {
      code: "DOCUMENT_CONTROL_UNAVAILABLE",
      message: "Controlled document revision history could not be read.",
      status: "unavailable"
    };
  }
}
