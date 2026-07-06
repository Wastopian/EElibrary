/**
 * File header: Pure formatting helpers for the part detail route.
 *
 * Every helper here is a deterministic mapper from data to display string.
 * Nothing in this file touches React, server actions, or fetches.
 */

import type {
  Asset,
  AssetProvenance,
  DocumentAccessLevel,
  DocumentAclPrincipalType,
  DocumentControlType,
  DocumentRedlineStatus,
  DocumentRevisionLifecycleStatus,
  InventoryStatus,
  PreviewStatus,
  PriceBreak,
  ProjectPartUsageStatus,
  SupplyOffering,
  ValidationStatus
} from "@ee-library/shared/types";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import type { BadgeTone } from "@ee-library/ui";
import type { PartDetailPageRecord } from "./types";

/**
 * Formats an ISO timestamp for dense workspace metadata.
 */
export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

/**
 * Formats a date-only string without shifting it across time zones.
 */
export function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Formats a project revision label without duplicating labels that already include "Rev".
 */
export function formatRevisionLabel(value: string): string {
  return /^rev\b/iu.test(value.trim()) ? value : `Rev ${value}`;
}

/**
 * Formats controlled document type values for dense workstation copy.
 */
export function formatDocumentType(type: DocumentControlType): string {
  return {
    controlled_drawing: "Controlled drawing",
    datasheet: "Datasheet",
    mechanical_drawing: "Mechanical drawing",
    other: "Other document",
    specification: "Specification"
  }[type];
}

/**
 * Formats controlled document lifecycle values.
 */
export function formatDocumentLifecycle(status: DocumentRevisionLifecycleStatus): string {
  return {
    archived: "Archived",
    draft: "Draft",
    expired: "Expired",
    in_review: "In review",
    released: "Released",
    superseded: "Superseded"
  }[status];
}

/**
 * Formats controlled document access levels.
 */
export function formatDocumentAccess(accessLevel: DocumentAccessLevel): string {
  return {
    internal: "Internal",
    itar_controlled: "ITAR controlled",
    public: "Public",
    restricted: "Restricted"
  }[accessLevel];
}

/**
 * Formats one ACL principal for revision history.
 */
export function formatAclPrincipal(principalType: DocumentAclPrincipalType, principalId: string): string {
  return `${principalType}:${principalId}`;
}

/**
 * Formats document redline workflow states.
 */
export function formatRedlineStatus(status: DocumentRedlineStatus): string {
  return {
    open: "Open",
    rejected: "Rejected",
    resolved: "Resolved",
    superseded: "Superseded"
  }[status];
}

/**
 * Formats project usage status into stable workstation copy.
 */
export function formatUsageStatus(status: ProjectPartUsageStatus): string {
  const labels: Record<ProjectPartUsageStatus, string> = {
    deprecated: "Deprecated",
    in_review: "In review",
    proposed: "Proposed",
    released: "Released",
    used: "Used"
  };

  return labels[status];
}

/**
 * Formats commercial inventory status labels without implying a live provider check.
 */
export function formatInventoryStatus(status: InventoryStatus): string {
  const labels: Record<InventoryStatus, string> = {
    backorder: "Backorder",
    in_stock: "In stock",
    out_of_stock: "Out of stock",
    unknown: "Unknown"
  };

  return labels[status];
}

/**
 * Formats supplier identity while falling back to provider provenance when the seller is not captured.
 */
export function formatSupplySourceLabel(source: { providerId: string; supplierName: string | null }): string {
  return source.supplierName ?? source.providerId;
}

/** PROVIDER_DISPLAY_LABELS maps known provider ids to the names engineers recognize. */
const PROVIDER_DISPLAY_LABELS: Record<string, string> = {
  digikey: "DigiKey",
  jlcparts: "JLCPCB / LCSC",
  kicad: "KiCad library",
  local: "Local catalog",
  mouser: "Mouser",
  octopart: "Octopart"
};

/**
 * Formats a provider id into a distributor name engineers recognize, leaving unknown ids untouched.
 */
export function formatProviderLabel(providerId: string): string {
  return PROVIDER_DISPLAY_LABELS[providerId] ?? providerId;
}

/**
 * Formats MOQ and lead-time terms while preserving missing values as unknown.
 */
export function formatSupplyTerms(offer: SupplyOffering): string {
  const moq = offer.moq === null ? "MOQ unknown" : `MOQ ${formatInteger(offer.moq)}`;
  const leadTime = offer.leadTimeDays === null ? "lead time unknown" : `${offer.leadTimeDays} day${offer.leadTimeDays === 1 ? "" : "s"} lead`;

  return `${moq} / ${leadTime}`;
}

/**
 * Selects the lowest price break for one offer and keeps the MOQ tie-break deterministic.
 */
export function getBestPriceBreak(priceBreaks: PriceBreak[]): PriceBreak | null {
  const sorted = [...priceBreaks].sort((left, right) => left.unitPrice - right.unitPrice || left.minQuantity - right.minQuantity);

  return sorted[0] ?? null;
}

/**
 * Formats a price tier with currency and quantity context.
 */
export function formatPriceBreak(priceBreak: PriceBreak): string {
  return `${formatSupplyPrice(priceBreak.unitPrice, priceBreak.currencyCode)} at ${formatInteger(priceBreak.minQuantity)}+`;
}

/**
 * Formats a provider price with a safe fallback for unexpected currency codes.
 */
export function formatSupplyPrice(unitPrice: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      currency: currencyCode,
      maximumFractionDigits: unitPrice < 1 ? 6 : 2,
      minimumFractionDigits: unitPrice < 1 ? 4 : 2,
      style: "currency"
    }).format(unitPrice);
  } catch {
    return `${unitPrice.toFixed(unitPrice < 1 ? 4 : 2)} ${currencyCode}`;
  }
}

/**
 * Formats integer-like quantities with thousands separators.
 */
export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

/**
 * Checks whether a commercial snapshot is older than the API's freshness window.
 */
export function isSupplyOfferStale(lastSeenAt: string, staleAfterDays: number): boolean {
  const parsed = Date.parse(lastSeenAt);

  if (!Number.isFinite(parsed)) {
    return true;
  }

  return Date.now() - parsed > staleAfterDays * 24 * 60 * 60 * 1000;
}

/**
 * Formats BOM designators without hiding the difference between none and unknown.
 */
export function formatDesignators(designators: string[]): string {
  return designators.length > 0 ? designators.join(", ") : "None recorded";
}

/**
 * Formats nullable BOM quantity without pretending unknown is zero.
 */
export function formatQuantity(quantity: number | null): string {
  return quantity === null ? "Unknown" : quantity.toString();
}

/**
 * Maps asset type values into user-facing labels.
 */
export function assetTypeLabel(assetOrType: Asset | Asset["assetType"]): string {
  const assetType = typeof assetOrType === "string" ? assetOrType : assetOrType.assetType;

  return {
    datasheet: "Datasheet",
    footprint: "Footprint",
    mechanical_drawing: "Mechanical drawing",
    symbol: "Symbol",
    three_d_model: "3D model"
  }[assetType];
}

/**
 * Maps validation status values into direct user-facing labels.
 */
export function validationLabel(status: ValidationStatus): string {
  return {
    failed: "Validation failed",
    needs_review: "Needs review",
    not_validated: "Not validated",
    verified: "Verified"
  }[status];
}

/**
 * Maps provenance values without treating provenance as validation.
 */
export function provenanceLabel(provenance: AssetProvenance): string {
  return {
    generated: "Generated",
    manual_internal: "Manual internal",
    official: "Official",
    trusted_external: "Trusted vendor"
  }[provenance];
}

/**
 * Maps preview status into short user-facing copy.
 */
export function previewLabel(status: PreviewStatus): string {
  return { not_available: "No preview", pending: "Preview pending", ready: "Preview ready" }[status];
}

/**
 * Labels datasheet file state without treating references as stored files.
 */
export function datasheetAssetLabel(asset: Asset | undefined): string {
  if (!asset) {
    return "No datasheet on file";
  }

  if (isFileBackedAsset(asset)) {
    return "Stored datasheet file";
  }

  return asset.sourceUrl ? "Link to datasheet only" : "Datasheet info only — no file";
}

/**
 * Builds the concise answer to "can I use this part?" from stored readiness truth.
 */
export function buildUseDecision(record: PartDetailPageRecord): { detail: string; headline: string; label: string; tone: BadgeTone } {
  if (record.readinessSummary.status === "ready_for_export_review") {
    return {
      detail: "Looks good. Still check the CAD files before adding to a design.",
      headline: "Usable after a quick file check",
      label: "Review-ready",
      tone: "verified"
    };
  }

  if (record.readinessSummary.status === "blocked") {
    return {
      detail: record.readinessSummary.detail,
      headline: "Do not use yet",
      label: "Blocked",
      tone: "danger"
    };
  }

  if (record.readinessSummary.status === "needs_attention") {
    return {
      detail: record.readinessSummary.detail,
      headline: "Use only after follow-up",
      label: "Needs attention",
      tone: "review"
    };
  }

  return {
    detail: "We do not have enough info yet to say this is safe to use. Review the part before adding to a design.",
    headline: "Not enough info yet",
    label: "Unknown",
    tone: "neutral"
  };
}

/**
 * Formats the connector confidence breakdown so engineers can inspect the score inputs quickly.
 */
export function buildConnectorConfidenceSummary(buildableMatingSet: PartDetailPageRecord["buildableMatingSet"]): string {
  const detailParts: string[] = [];
  const evidenceParts: string[] = [];

  if (buildableMatingSet.confidenceBreakdown.overallScore !== null) {
    detailParts.push(`Overall ${Math.round(buildableMatingSet.confidenceBreakdown.overallScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.bestMateScore !== null) {
    detailParts.push(`best mate ${Math.round(buildableMatingSet.confidenceBreakdown.bestMateScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.requiredAccessoryScore !== null) {
    detailParts.push(`required accessories ${Math.round(buildableMatingSet.confidenceBreakdown.requiredAccessoryScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.optionalAccessoryScore !== null) {
    detailParts.push(`optional accessories ${Math.round(buildableMatingSet.confidenceBreakdown.optionalAccessoryScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.toolingScore !== null) {
    detailParts.push(`tooling ${Math.round(buildableMatingSet.confidenceBreakdown.toolingScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.cableScore !== null) {
    detailParts.push(`cables ${Math.round(buildableMatingSet.confidenceBreakdown.cableScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.directEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.directEvidenceCount} direct`);
  }

  if (buildableMatingSet.confidenceBreakdown.inferredEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.inferredEvidenceCount} inferred`);
  }

  if (buildableMatingSet.confidenceBreakdown.verifiedEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.verifiedEvidenceCount} verified`);
  }

  if (buildableMatingSet.confidenceBreakdown.uncertainEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.uncertainEvidenceCount} uncertain`);
  }

  if (detailParts.length === 0) {
    return "No connector confidence info is stored.";
  }

  return `${detailParts.join("; ")} from ${buildableMatingSet.confidenceBreakdown.evidenceCount} mapped relationship signals${evidenceParts.length > 0 ? ` (${evidenceParts.join(", ")})` : ""}.`;
}
