/**
 * File header: Provides seed fallback search and detail helpers.
 */

import { filterPartRecords, getSearchFacetsFromRecords } from "./catalog-runtime";
import { buildBuildableMatingSet } from "./connector-intelligence";
import {
  accessoryRequirements,
  assets,
  cableCompatibilities,
  companionRecommendations,
  connectorFamilies,
  datasheetRevisions,
  generationWorkflows,
  manufacturers,
  mateRelations,
  partMetrics,
  partPackages,
  parts,
  similarPartRelations,
  sourceRecords
} from "./seed";
import type {
  AccessoryRequirement,
  CableCompatibility,
  MateRelation,
  PartSearchFilters,
  PartSearchRecord,
  SearchFacets
} from "./types";

export { filterPartRecords, formatAssetStatus, formatMetricLabel, formatMetricValue, getExportAvailability, getSearchFacetsFromRecords, getVerifiedCadAssetCount } from "./catalog-runtime";
export { buildBuildableMatingSet } from "./connector-intelligence";

/** manufacturerById supports deterministic joining from seed tables. */
const manufacturerById = new Map(manufacturers.map((manufacturer) => [manufacturer.id, manufacturer]));

/** packageById supports deterministic joining from seed tables. */
const packageById = new Map(partPackages.map((partPackage) => [partPackage.id, partPackage]));

/** connectorFamilyById supports deterministic connector family lookups. */
const connectorFamilyById = new Map(connectorFamilies.map((family) => [family.id, family]));

/**
 * Builds all provider-neutral records from the seed fallback catalog.
 */
export function getAllPartRecords(): PartSearchRecord[] {
  return parts.flatMap((part) => {
    const record = buildPartSearchRecord(part.id);
    return record ? [record] : [];
  });
}

/**
 * Returns one joined seed fallback detail record by canonical part identifier.
 */
export function getPartDetail(partId: string): PartSearchRecord | undefined {
  return getAllPartRecords().find((record) => record.part.id === partId);
}

/**
 * Searches the seed fallback catalog with provider-neutral filters.
 */
export function searchParts(filters: PartSearchFilters = {}): PartSearchRecord[] {
  return filterPartRecords(getAllPartRecords(), filters);
}

/**
 * Builds the provider-neutral search facets exposed by the API.
 */
export function getSearchFacets(): SearchFacets {
  return getSearchFacetsFromRecords(getAllPartRecords());
}

/**
 * Builds one joined seed record while preserving provenance and relationship data.
 */
function buildPartSearchRecord(partId: string): PartSearchRecord | null {
  const part = parts.find((candidate) => candidate.id === partId);

  if (!part) {
    return null;
  }

  const manufacturer = manufacturerById.get(part.manufacturerId);
  const packageRecord = packageById.get(part.packageId);

  if (!manufacturer || !packageRecord) {
    return null;
  }

  const partAssets = sortById(assets.filter((asset) => asset.partId === part.id));
  const partDatasheetRevision = selectLatestDatasheetRevision(part.id);
  const partMateRelations = sortRelationsByConfidence(mateRelations.filter((relation) => relation.partId === part.id));
  const partAccessories = sortRelationsByConfidence(accessoryRequirements.filter((requirement) => requirement.partId === part.id));
  const partCables = sortRelationsByConfidence(cableCompatibilities.filter((compatibility) => compatibility.partId === part.id));
  const partMetricsForRecord = sortById(partMetrics.filter((metric) => metric.partId === part.id));
  const partSources = sourceRecords.filter((sourceRecord) => sourceRecord.partId === part.id).sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt) || left.id.localeCompare(right.id));
  const partSimilarParts = sortRelationsByConfidence(similarPartRelations.filter((relation) => relation.partId === part.id));
  const partCompanions = sortRelationsByConfidence(companionRecommendations.filter((recommendation) => recommendation.partId === part.id));
  const partWorkflows = sortRelationsByConfidence(generationWorkflows.filter((workflow) => workflow.partId === part.id));

  return {
    accessoryRequirements: partAccessories,
    assets: partAssets,
    buildableMatingSet: buildBuildableMatingSet(partMateRelations, partAccessories, partCables),
    cableCompatibilities: partCables,
    companionRecommendations: partCompanions,
    connectorFamily: part.connectorFamilyId ? connectorFamilyById.get(part.connectorFamilyId) ?? null : null,
    datasheetRevision: partDatasheetRevision,
    generationWorkflows: partWorkflows,
    lastUpdatedAt: latestTimestamp([
      part.lastUpdatedAt,
      ...partAssets.map((asset) => asset.lastUpdatedAt),
      ...partMetricsForRecord.map((metric) => metric.lastUpdatedAt),
      ...(partDatasheetRevision ? [partDatasheetRevision.lastUpdatedAt] : []),
      ...partSources.map((sourceRecord) => sourceRecord.lastUpdatedAt)
    ]),
    manufacturer,
    mateRelations: partMateRelations,
    metrics: partMetricsForRecord,
    package: packageRecord,
    part,
    similarParts: partSimilarParts,
    sources: partSources
  };
}

/**
 * Selects the newest datasheet revision for a part without mutating seed data.
 */
function selectLatestDatasheetRevision(partId: string) {
  const revisions = datasheetRevisions.filter((revision) => revision.partId === partId);

  return (
    [...revisions]
      .sort((first, second) => {
        const firstDate = Date.parse(first.revisionDate ?? first.lastUpdatedAt);
        const secondDate = Date.parse(second.revisionDate ?? second.lastUpdatedAt);

        return secondDate - firstDate || first.id.localeCompare(second.id);
      })[0] ?? null
  );
}

/**
 * Sorts relationship-like objects by confidence and stable identifier.
 */
function sortRelationsByConfidence<TValue extends { confidenceScore: number; id: string }>(values: TValue[]): TValue[] {
  return [...values].sort((left, right) => right.confidenceScore - left.confidenceScore || left.id.localeCompare(right.id));
}

/**
 * Sorts identifier-bearing records in a deterministic order.
 */
function sortById<TValue extends { id: string }>(values: TValue[]): TValue[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Returns the newest ISO timestamp in a set of timestamp strings.
 */
function latestTimestamp(timestamps: string[]): string {
  return [...timestamps].sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? new Date(0).toISOString();
}
