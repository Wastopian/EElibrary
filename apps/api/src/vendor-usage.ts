/**
 * File header: Reverse vendor lookup - which catalog parts record a distributor offer from one
 * supplier. Powers the "Parts sourced from this supplier" section on the vendor workspace page,
 * closing the loop with the forward link from a part's distributor offers to its vendor notes.
 */

import { Pool } from "pg";
import type { VendorUsagePart, VendorUsageResponse } from "@ee-library/shared/types";
import { buildVendorDetailResponse } from "./vendors";

/** vendorUsagePool is the lazily created Postgres pool for vendor usage reads. */
let vendorUsagePool: Pool | null = null;

/**
 * Normalizes a supplier/vendor name into a comparison key so offers match the vendor record
 * despite punctuation/casing differences (e.g. "Digi-Key" and "DigiKey" both reduce to "digikey").
 * Mirrors the web-side vendorMatchKey used for the forward link.
 */
function vendorMatchKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

/**
 * Builds the reverse vendor-to-parts usage payload for one vendor slug. Resolves the vendor's
 * display name from the on-disk record, then matches distributor offers by normalized supplier
 * name. Returns an empty parts list (never throws) when the DB or vendor is unavailable so the
 * vendor page renders calmly.
 */
export async function buildVendorUsageResponse(slug: string): Promise<VendorUsageResponse> {
  const detail = await buildVendorDetailResponse(slug);
  const vendorName = detail.vendor?.name ?? null;

  if (!vendorName || !isDatabaseConfigured()) {
    return { slug, vendorName, parts: [] };
  }

  try {
    const databasePool = getDatabasePool();
    const result = await databasePool.query<{
      part_id: string;
      mpn: string;
      manufacturer_name: string | null;
      supplier_name: string | null;
      inventory_status: string;
      last_seen_at: Date | string;
    }>(
      `
        SELECT DISTINCT ON (o.part_id)
          o.part_id,
          p.mpn,
          m.name AS manufacturer_name,
          o.supplier_name,
          o.inventory_status,
          o.last_seen_at
        FROM supply_offerings o
        INNER JOIN parts p ON p.id = o.part_id
        LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
        WHERE o.retired_at IS NULL
          AND o.supplier_name IS NOT NULL
          AND lower(regexp_replace(o.supplier_name, '[^a-zA-Z0-9]', '', 'g')) = $1
        ORDER BY o.part_id, o.last_seen_at DESC NULLS LAST
      `,
      [vendorMatchKey(vendorName)]
    );

    const parts: VendorUsagePart[] = result.rows.map((row) => ({
      partId: row.part_id,
      mpn: row.mpn,
      manufacturerName: row.manufacturer_name,
      supplierName: row.supplier_name ?? vendorName,
      inventoryStatus: row.inventory_status,
      lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : row.last_seen_at.toISOString()
    }));

    parts.sort((left, right) => left.mpn.localeCompare(right.mpn, undefined, { sensitivity: "base" }));

    return { slug, vendorName, parts };
  } catch {
    return { slug, vendorName, parts: [] };
  }
}

/** Returns true when DATABASE_URL is configured for vendor usage reads. */
function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/** Lazily creates the Postgres pool when DATABASE_URL exists. */
function getDatabasePool(): Pool {
  if (vendorUsagePool) {
    return vendorUsagePool;
  }

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  vendorUsagePool = new Pool({ connectionString });

  return vendorUsagePool;
}
