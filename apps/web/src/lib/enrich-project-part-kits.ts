/**
 * File header: Fills missing project part kit fields from catalog part detail when the kits API omits them.
 */

import { selectBestAvailableAsset } from "@ee-library/shared/asset-resolution";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import type { Asset, AssetType, PartDetailResponse, ProjectPartKit, ProjectPartKitFileRef } from "@ee-library/shared/types";
import { fetchPartDetail } from "./api-client";

const ENRICH_CONCURRENCY = 8;

/**
 * Enriches kits that are missing datasheet, supplier URL, or description using catalog detail truth.
 */
export async function enrichPartKitsWithCatalogDetail(kits: ProjectPartKit[]): Promise<ProjectPartKit[]> {
  const targets = kits.filter(
    (kit) => !kit.datasheet || !kit.model || !kit.footprint || !kit.partUrl?.trim() || !kit.note?.trim()
  );

  if (targets.length === 0) {
    return kits;
  }

  const enrichedByPartId = new Map<string, ProjectPartKit>();

  for (let index = 0; index < targets.length; index += ENRICH_CONCURRENCY) {
    const chunk = targets.slice(index, index + ENRICH_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (kit) => {
        try {
          const detail = await fetchPartDetail(kit.partId);

          return detail ? mergeCatalogHintsIntoPartKit(kit, detail) : kit;
        } catch {
          return kit;
        }
      })
    );

    for (const kit of results) {
      enrichedByPartId.set(kit.partId, kit);
    }
  }

  return kits.map((kit) => enrichedByPartId.get(kit.partId) ?? kit);
}

/**
 * Merges catalog datasheet, source URL, and description into one kit without overwriting BOM values.
 */
export function mergeCatalogHintsIntoPartKit(kit: ProjectPartKit, detail: PartDetailResponse): ProjectPartKit {
  const { record } = detail;
  const datasheetAsset = resolveDatasheetAsset(record);
  const modelAsset = resolveKitAsset(record.assets, "three_d_model");
  const footprintAsset = resolveKitAsset(record.assets, "footprint");
  const catalogUrl =
    normalizeOptionalText(detail.acquisitionSummary.sourceUrl) ??
    normalizeOptionalText(record.sources.find((source) => source.sourceUrl)?.sourceUrl ?? null);
  const catalogNote = normalizeOptionalText(record.part.description);

  return {
    ...kit,
    datasheet: kit.datasheet ?? (datasheetAsset ? buildCatalogKitFileRefFromAsset(record.part.id, datasheetAsset) : null),
    footprint: kit.footprint ?? (footprintAsset ? buildCatalogKitFileRefFromAsset(record.part.id, footprintAsset) : null),
    model: kit.model ?? (modelAsset ? buildCatalogKitFileRefFromAsset(record.part.id, modelAsset) : null),
    note: kit.note ?? catalogNote,
    partUrl: kit.partUrl ?? catalogUrl
  };
}

/**
 * Resolves the primary datasheet asset the same way the part detail page does.
 */
function resolveDatasheetAsset(record: PartDetailResponse["record"]): Asset | undefined {
  const revisionAssetId = record.datasheetRevision?.fileAssetId;

  if (revisionAssetId) {
    const revisionAsset = record.assets.find((asset) => asset.id === revisionAssetId);

    if (revisionAsset && isFileBackedAsset(revisionAsset)) {
      return revisionAsset;
    }
  }

  return resolveKitAsset(record.assets, "datasheet");
}

/**
 * Picks the same best asset the part detail page uses for one kit slot.
 */
function resolveKitAsset(assets: Asset[], assetType: AssetType): Asset | undefined {
  const best = selectBestAvailableAsset(assets.filter((asset) => asset.assetType === assetType));

  if (!best) {
    return undefined;
  }

  if (isFileBackedAsset(best) || best.sourceUrl) {
    return best;
  }

  return undefined;
}

/**
 * Builds a kit file reference from one catalog asset.
 */
function buildCatalogKitFileRefFromAsset(partId: string, asset: Asset): ProjectPartKitFileRef {
  const category =
    asset.assetType === "datasheet" ? "datasheets" : asset.assetType === "three_d_model" ? "models" : "footprints";
  const name =
    asset.storageKey?.split("/").pop() ??
    asset.sourceUrl?.split("/").pop() ??
    `${asset.id}.${asset.fileFormat ?? "bin"}`;
  const downloadUrl = asset.storageKey
    ? `/api/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(asset.id)}/download`
    : (asset.sourceUrl ?? undefined);

  return {
    assetId: asset.id,
    category,
    ...(downloadUrl !== undefined ? { downloadUrl } : {}),
    name,
    relativePath: asset.storageKey ?? asset.sourceUrl ?? `catalog/${asset.id}`,
    source: "catalog"
  };
}

/**
 * Trims optional text fields to null when empty.
 */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
