#!/usr/bin/env node
/**
 * File header: Inserts a small set of demo parts (manufacturers, packages, parts, datasheets,
 * metrics, assets, source records) into Postgres. Idempotent via ON CONFLICT clauses.
 */

import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient } from "./lib/db.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";
import {
  LAST_UPDATED_AT,
  manufacturers,
  partPackages,
  parts,
  sourceRecords,
  datasheetRevisions,
  partMetrics,
  assets
} from "./lib/demo-parts.mjs";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const client = await connectClient();
  try {
    await client.query("BEGIN");
    try {
      const insertedManufacturers = await upsertManufacturers(client);
      const insertedPackages = await upsertPackages(client);
      const insertedSources = await upsertSourceRecords(client);
      const insertedParts = await upsertParts(client);
      const insertedDatasheets = await upsertDatasheets(client);
      const insertedMetrics = await upsertMetrics(client);
      const insertedAssets = await upsertAssets(client);

      await client.query("COMMIT");

      console.log("seed:parts: catalog rows present");
      console.log(`  manufacturers:       ${insertedManufacturers}`);
      console.log(`  packages:            ${insertedPackages}`);
      console.log(`  source_records:      ${insertedSources}`);
      console.log(`  parts:               ${insertedParts}`);
      console.log(`  datasheet_revisions: ${insertedDatasheets}`);
      console.log(`  part_metrics:        ${insertedMetrics}`);
      console.log(`  assets:              ${insertedAssets}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function upsertManufacturers(client) {
  let count = 0;
  for (const row of manufacturers) {
    const result = await client.query(
      `INSERT INTO manufacturers (id, name, aliases, website)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.name, row.aliases, row.website]
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

async function upsertPackages(client) {
  let count = 0;
  for (const row of partPackages) {
    const result = await client.query(
      `INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.packageName, row.pinCount, row.pitchMm, row.bodyLengthMm, row.bodyWidthMm, row.bodyHeightMm]
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

async function upsertSourceRecords(client) {
  let count = 0;
  for (const row of sourceRecords) {
    const result = await client.query(
      `INSERT INTO source_records (id, provider_id, provider_part_key, part_id, source_url, fetched_at, raw_payload, normalized_at, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.providerId,
        row.providerPartKey,
        row.partId,
        row.sourceUrl,
        LAST_UPDATED_AT,
        JSON.stringify(row.rawPayload),
        LAST_UPDATED_AT,
        LAST_UPDATED_AT
      ]
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

async function upsertParts(client) {
  let count = 0;
  for (const row of parts) {
    const result = await client.query(
      `INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.mpn, row.manufacturerId, row.category, row.lifecycleStatus, row.packageId, row.trustScore, LAST_UPDATED_AT]
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

async function upsertDatasheets(client) {
  let count = 0;
  for (const row of datasheetRevisions) {
    const result = await client.query(
      `INSERT INTO datasheet_revisions (id, part_id, revision_label, revision_date, page_count, file_asset_id, parse_confidence, source_record_id, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.partId,
        row.revisionLabel,
        row.revisionDate,
        row.pageCount,
        null,
        row.parseConfidence,
        row.sourceRecordId,
        LAST_UPDATED_AT
      ]
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

async function upsertMetrics(client) {
  let count = 0;
  for (const row of partMetrics) {
    const result = await client.query(
      `INSERT INTO part_metrics (id, part_id, metric_key, metric_value, unit, min_value, max_value, confidence_score, source_revision_id, source_record_id, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.partId,
        row.metricKey,
        row.metricValue,
        row.unit,
        row.minValue,
        row.maxValue,
        row.confidenceScore,
        row.sourceRevisionId,
        row.sourceRecordId,
        LAST_UPDATED_AT
      ]
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

async function upsertAssets(client) {
  let count = 0;
  for (const row of assets) {
    const result = await client.query(
      `INSERT INTO assets (id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode, validation_status, preview_status, asset_state, source_url, source_record_id, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.partId,
        row.assetType,
        row.fileFormat,
        row.storageKey,
        row.fileHash,
        row.providerId,
        row.licenseMode,
        row.validationStatus,
        row.previewStatus,
        row.assetState,
        row.sourceUrl,
        row.sourceRecordId,
        LAST_UPDATED_AT
      ]
    );
    count += result.rowCount ?? 0;
  }
  // Datasheet asset references back into the file_asset_id column once both rows exist.
  await client.query(
    `UPDATE datasheet_revisions
        SET file_asset_id = sub.asset_id
       FROM (
         SELECT id AS asset_id, part_id FROM assets WHERE asset_type = 'datasheet'
       ) AS sub
      WHERE datasheet_revisions.part_id = sub.part_id
        AND datasheet_revisions.file_asset_id IS NULL`
  );
  return count;
}

main().catch((error) => {
  console.error("seed:parts failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
