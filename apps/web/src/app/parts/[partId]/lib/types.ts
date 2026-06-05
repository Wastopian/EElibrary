/**
 * File header: Type aliases shared across the part detail route's extracted modules.
 *
 * Co-located here (not in @ee-library/shared) because they are derived from the
 * route-specific API client return shapes and only used inside this route's
 * sections and helpers.
 */

import type { fetchPartDetail } from "../../../../lib/api-client";
import type {
  CatalogDataSource,
  DocumentRevisionListResponse,
  PartSupplyOffersResponse,
  PartWhereUsedResponse
} from "@ee-library/shared/types";
import type { BadgeTone } from "@ee-library/ui";

/** PartDetailPageDetail extracts the full detail payload shape directly from the API client return type. */
export type PartDetailPageDetail = NonNullable<Awaited<ReturnType<typeof fetchPartDetail>>>;

/** PartDetailPageRecord extracts the detail record shape directly from the API client return type. */
export type PartDetailPageRecord = PartDetailPageDetail["record"];

/** DetailRiskFlag keeps derived risk messaging explicit and severity-based. */
export type DetailRiskFlag = {
  detail: string;
  title: string;
  tone: "danger" | "review";
};

/** PartWhereUsedState keeps part detail renderable when project memory is unavailable. */
export type PartWhereUsedState =
  | { status: "available"; response: PartWhereUsedResponse }
  | { status: "not_found" }
  | { status: "unavailable"; code: string; message: string };

/** PartDocumentControlState keeps document-control history optional while the catalog can still render. */
export type PartDocumentControlState =
  | { status: "available"; response: DocumentRevisionListResponse }
  | { status: "not_found" }
  | { status: "unavailable"; code: string; message: string };

/** PartSupplyOffersState keeps sourcing snapshots optional beside canonical part truth. */
export type PartSupplyOffersState =
  | { status: "available"; response: PartSupplyOffersResponse }
  | { status: "not_found" }
  | { status: "unavailable"; code: string; message: string };

/** PartDetailPageState keeps catalog setup errors separate from genuine 404s. */
export type PartDetailPageState =
  | {
      detail: PartDetailPageDetail;
      documentControlState: PartDocumentControlState;
      source: CatalogDataSource | undefined;
      status: "ready";
      supplyOffersState: PartSupplyOffersState;
      whereUsedState: PartWhereUsedState;
    }
  | { status: "not_found" }
  | {
      code: string;
      message: string;
      partId: string;
      status: "setup_required";
      whereUsedState: PartWhereUsedState;
    };

/** AssetTrustCheckSummary is the operator-facing result of the latest durable asset check. */
export type AssetTrustCheckSummary = {
  detail: string;
  label: string;
  tone: BadgeTone;
};

/** PartFilesRow describes one row of the Files and downloads panel. */
export type PartFilesRow = {
  action: { href: string; label: string } | null;
  format: string | null | undefined;
  label: string;
  status: { label: string; tone: BadgeTone };
  trustCheck: AssetTrustCheckSummary;
  unavailableLabel: string;
};
