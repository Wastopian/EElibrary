/**
 * File header: Implements a worker-only local KiCad CAD index adapter with no network calls.
 */

import { readdir } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import type { AssetType, FileFormat } from "@ee-library/shared/types";
import type { NormalizedProviderPart, ProviderAdapter, ProviderPartRequest, RawProviderPayload } from "../provider-adapters";
import { buildExactLookupCandidate } from "../provider-lookup-candidate";
import {
  assembleNormalizedPart,
  normalizeComparableText,
  normalizeOptionalText,
  readPinCountFromPackage,
  type NeutralCadAsset
} from "./distributor-normalize";

/** KICAD_PROVIDER_ID is the canonical adapter id for the local KiCad CAD index. */
const KICAD_PROVIDER_ID = "kicad";

/** DEFAULT_KICAD_LIBRARY_ROOT keeps the adapter usable without explicit configuration. */
const DEFAULT_KICAD_LIBRARY_ROOT = "./data/providers/kicad";

/** MAX_ENUMERATED_REQUESTS bounds the no-argument enumeration so drain runs stay deterministic. */
const MAX_ENUMERATED_REQUESTS = 200;

/** INDEXED_EXTENSIONS maps supported CAD file extensions to their canonical asset facets. */
const INDEXED_EXTENSIONS: Record<string, { assetType: AssetType; fileFormat: FileFormat }> = {
  ".kicad_mod": { assetType: "footprint", fileFormat: "kicad_mod" },
  ".kicad_sym": { assetType: "symbol", fileFormat: "kicad_sym" },
  ".step": { assetType: "three_d_model", fileFormat: "step" },
  ".stp": { assetType: "three_d_model", fileFormat: "step" }
};

/** KicadIndexedFile is one discovered CAD file on disk. */
interface KicadIndexedFile {
  /** Identity stem shared by related symbol/footprint/model files. */
  stem: string;
  /** Library directory name (for example a .pretty footprint library). */
  library: string;
  /** Absolute file path preserved for provenance. */
  filePath: string;
  /** Canonical engineering asset class. */
  assetType: AssetType;
  /** Canonical file format. */
  fileFormat: FileFormat;
}

/** KicadRawPayload preserves the grouped CAD files for one indexed part. */
interface KicadRawPayload {
  /** Identity stem used as the MPN-equivalent key. */
  stem: string;
  /** Library directory name. */
  library: string;
  /** Grouped CAD files that share the stem. */
  files: KicadIndexedFile[];
}

/** kicadProviderAdapter indexes local public KiCad CAD libraries. */
export const kicadProviderAdapter: ProviderAdapter = {
  async findExactPartCandidates(request) {
    try {
      const rawPayload = await fetchKicadRawPart({ mpn: request.query, providerPartId: request.query });

      return [buildExactLookupCandidate(normalizeRawPart(rawPayload), request.query)];
    } catch (error) {
      if (isKicadNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  },
  async fetchRawPart(request) {
    return fetchKicadRawPart(request);
  },
  id: KICAD_PROVIDER_ID,
  async listAvailablePartRequests() {
    const groups = await indexLibraryGroups();

    return [...groups.keys()]
      .sort((first, second) => first.localeCompare(second))
      .slice(0, MAX_ENUMERATED_REQUESTS)
      .map((key) => ({ providerPartId: groups.get(key)?.stem ?? key }));
  },
  name: "Local KiCad CAD index",
  normalizeRawPart
};

/**
 * Reads the configured KiCad library root. Exported so the asset byte-ingestion job validates that a
 * referenced KiCad file actually lives under the trusted root before reading it.
 */
export function readKicadLibraryRoot(): string {
  return normalizeOptionalText(process.env.KICAD_LIBRARY_ROOT) ?? DEFAULT_KICAD_LIBRARY_ROOT;
}

/**
 * Walks the library root and groups CAD files by identity stem.
 * A missing or empty root yields an empty index instead of an error.
 */
async function indexLibraryGroups(): Promise<Map<string, KicadRawPayload>> {
  const root = readKicadLibraryRoot();
  const groups = new Map<string, KicadRawPayload>();

  let entries: string[];

  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return groups;
  }

  for (const relativePath of entries.sort((first, second) => first.localeCompare(second))) {
    const extension = extname(relativePath).toLowerCase();
    const facet = INDEXED_EXTENSIONS[extension];

    if (!facet) {
      continue;
    }

    const stem = basename(relativePath, extname(relativePath));
    const segments = relativePath.split(/[\\/]/u);
    const library = segments.length > 1 ? (segments[segments.length - 2] ?? "kicad") : "kicad";
    const groupKey = normalizeComparableText(stem);
    const indexedFile: KicadIndexedFile = {
      assetType: facet.assetType,
      fileFormat: facet.fileFormat,
      filePath: join(root, relativePath).split(/[\\/]/u).join(sep),
      library,
      stem
    };
    const existing = groups.get(groupKey);

    if (existing) {
      existing.files.push(indexedFile);
    } else {
      groups.set(groupKey, { files: [indexedFile], library, stem });
    }
  }

  return groups;
}

/**
 * Fetches one indexed CAD group by exact stem (treated as the MPN-equivalent key).
 */
async function fetchKicadRawPart(request: ProviderPartRequest): Promise<RawProviderPayload> {
  const lookup = normalizeOptionalText(request.providerPartId) ?? normalizeOptionalText(request.mpn);

  if (!lookup) {
    throw new Error("KiCad CAD index record not found for unknown lookup");
  }

  const groups = await indexLibraryGroups();
  const group = groups.get(normalizeComparableText(lookup));

  if (!group) {
    throw new Error(`KiCad CAD index record not found for ${lookup}`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    payload: group satisfies KicadRawPayload,
    providerId: KICAD_PROVIDER_ID
  };
}

/**
 * Normalizes one indexed CAD group into provider-neutral canonical records.
 */
function normalizeRawPart(rawPayload: RawProviderPayload): NormalizedProviderPart {
  if (rawPayload.providerId !== KICAD_PROVIDER_ID) {
    throw new Error(`Unexpected KiCad provider id: ${rawPayload.providerId}`);
  }

  const payload = rawPayload.payload as Partial<KicadRawPayload> | null;

  if (!payload || typeof payload !== "object" || !payload.stem || !Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error("Invalid KiCad raw payload");
  }

  const stem = payload.stem;
  const library = payload.library ?? "kicad";
  const cadAssets: NeutralCadAsset[] = payload.files.map((file) => ({
    assetType: file.assetType,
    fileFormat: file.fileFormat,
    sourceUrl: file.filePath
  }));
  const facetSummary = [...new Set(payload.files.map((file) => file.assetType))].sort().join(", ");

  return assembleNormalizedPart({
    cadAssets,
    category: "Local CAD index / KiCad",
    datasheetUrl: null,
    description: `KiCad library "${library}" CAD reference (${facetSummary}) for ${stem}`,
    fetchedAt: rawPayload.fetchedAt,
    lifecycleStatus: "unknown",
    manufacturerName: "KiCad public library",
    manufacturerWebsite: "https://www.kicad.org",
    metrics: [],
    mpn: stem,
    packageName: library,
    pinCount: readPinCountFromPackage(stem),
    providerId: KICAD_PROVIDER_ID,
    providerPartKey: stem,
    rawPayload: payload,
    sourceUrl: payload.files[0]?.filePath ?? library,
    supplyOfferings: [],
    trustScore: 0.5
  });
}

/**
 * Returns whether an error represents a normal no-match local index outcome.
 */
function isKicadNotFoundError(error: unknown): boolean {
  return error instanceof Error && /KiCad CAD index record not found/u.test(error.message);
}
