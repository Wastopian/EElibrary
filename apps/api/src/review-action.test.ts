/**
 * File header: Tests explicit review action persistence and endpoint behavior.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createReviewInDatabase, promoteAssetForExportInDatabase, setCatalogStorePoolForTests } from "./catalog-store";
import type { Pool } from "pg";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Verifies an approved eligible asset is still not export verified until explicit promotion.
 */
test("createReviewInDatabase approves assets without automatically verifying export", async () => {
  const pool = createFakeReviewPool();

  try {
    setCatalogStorePoolForTests(pool as unknown as Pool);
    const result = await createReviewInDatabase(
      "part-a",
      {
        outcome: "approved",
        targetId: "asset-a-step",
        targetType: "asset"
      },
      "api-review-test",
      "2026-04-13T00:00:00.000Z"
    );

    assert.equal(result.status, "created");
    assert.deepEqual(pool.assetRow, {
      ...buildAssetRow(),
      asset_status: "reviewed",
      export_status: "not_exportable",
      last_updated_at: "2026-04-13T00:00:00.000Z",
      review_status: "approved",
      validation_status: "verified"
    });
  } finally {
    setCatalogStorePoolForTests(null);
  }
});

/**
 * Verifies explicit promotion is required before an approved asset reaches verified_for_export.
 */
test("promoteAssetForExportInDatabase verifies export only after approved review state", async () => {
  const pool = createFakeReviewPool();

  try {
    setCatalogStorePoolForTests(pool as unknown as Pool);

    const blockedResult = await promoteAssetForExportInDatabase("part-a", "asset-a-step", "2026-04-13T00:10:00.000Z");

    assert.equal(blockedResult.status, "not_promotable");
    assert.equal(pool.promotionAuditRows[0]?.promotion_outcome, "denied");
    assert.match(pool.promotionAuditRows[0]?.blocker_reasons.join(" ") ?? "", /approved review/u);

    await createReviewInDatabase(
      "part-a",
      {
        outcome: "approved",
        targetId: "asset-a-step",
        targetType: "asset"
      },
      "api-review-test",
      "2026-04-13T00:00:00.000Z"
    );
    pool.validationRows.push(buildValidationRow());

    const promotedResult = await promoteAssetForExportInDatabase("part-a", "asset-a-step", "2026-04-13T00:15:00.000Z");

    assert.equal(promotedResult.status, "promoted");
    assert.equal(promotedResult.response.promotionAudit.promotionOutcome, "promoted");
    assert.equal(promotedResult.response.promotionAudit.validationRecordId, "validation-asset-a-step-geometry");
    assert.equal(pool.promotionAuditRows.at(-1)?.promotion_outcome, "promoted");
    assert.deepEqual(pool.assetRow, {
      ...buildAssetRow(),
      availability_status: "validated",
      asset_state: "validated",
      asset_status: "verified_for_export",
      export_status: "verified_for_export",
      last_updated_at: "2026-04-13T00:15:00.000Z",
      review_status: "approved",
      validation_status: "verified"
    });
  } finally {
    setCatalogStorePoolForTests(null);
  }
});

/**
 * Verifies workflow review changes do not automatically verify output assets.
 */
test("createReviewInDatabase updates workflow review state without verifying output asset", async () => {
  const pool = createFakeReviewPool();

  try {
    setCatalogStorePoolForTests(pool as unknown as Pool);
    const result = await createReviewInDatabase(
      "part-a",
      {
        outcome: "changes_requested",
        targetId: "gen-a-step",
        targetType: "generation_workflow"
      },
      "api-review-test",
      "2026-04-13T00:00:00.000Z"
    );

    assert.equal(result.status, "created");
    assert.equal(pool.workflowRow.generation_status, "review_required");
    assert.equal(pool.assetRow.asset_status, "downloaded");
  } finally {
    setCatalogStorePoolForTests(null);
  }
});

/**
 * Verifies workflow approval also advances the linked request row out of review-required.
 */
test("createReviewInDatabase syncs linked generation request after workflow approval", async () => {
  const pool = createFakeReviewPool();

  try {
    setCatalogStorePoolForTests(pool as unknown as Pool);
    const result = await createReviewInDatabase(
      "part-a",
      {
        outcome: "approved",
        targetId: "gen-a-step",
        targetType: "generation_workflow"
      },
      "api-review-test",
      "2026-04-13T00:00:00.000Z"
    );

    assert.equal(result.status, "created");
    assert.equal(pool.workflowRow.generation_status, "approved");
    assert.equal(pool.requestRow.request_status, "approved");
    assert.equal(pool.requestRow.last_updated_at, "2026-04-13T00:00:00.000Z");
    assert.equal(pool.assetRow.asset_status, "downloaded");
  } finally {
    setCatalogStorePoolForTests(null);
  }
});

/**
 * Verifies review write endpoints do not pretend to work without a configured database.
 */
test("review action endpoint requires configured database", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  setCatalogStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiRequest("POST", "/parts/part-a/reviews", {
      outcome: "approved",
      targetId: "asset-a-step",
      targetType: "asset"
    }, handleRequest);

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, "DB_NOT_CONFIGURED");
  } finally {
    setCatalogStorePoolForTests(null);
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

/**
 * Verifies promotion endpoints do not pretend to work without a configured database.
 */
test("asset promotion endpoint requires configured database", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  setCatalogStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiRequest("POST", "/parts/part-a/asset-promotions", {
      assetId: "asset-a-step"
    }, handleRequest);

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, "DB_NOT_CONFIGURED");
  } finally {
    setCatalogStorePoolForTests(null);
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

/**
 * Creates a fake Pool that stores one reviewable generated 3D asset and workflow.
 */
function createFakeReviewPool() {
  const pool = {
    assetRow: buildAssetRow(),
    promotionAuditRows: [] as any[],
    requestRow: buildRequestRow(),
    reviewRows: [] as any[],
    validationRows: [] as any[],
    workflowRow: buildWorkflowRow(),
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          if (text.includes("INSERT INTO review_records") && values) {
            pool.reviewRows.push({
              asset_id: values[3],
              generation_workflow_id: values[4],
              id: values[0],
              last_updated_at: values[8],
              notes: values[7],
              outcome: values[5],
              part_id: values[1],
              reviewed_at: values[8],
              reviewer: values[6],
              target_type: values[2]
            });
          }

          if (text.includes("INSERT INTO asset_promotion_audits") && values) {
            pool.promotionAuditRows.push({
              actor: values[8],
              asset_id: values[2],
              blocker_reasons: values[6],
              created_at: values[9],
              id: values[0],
              new_export_status: values[4],
              part_id: values[1],
              prior_export_status: values[3],
              promotion_outcome: values[5],
              validation_record_id: values[7]
            });
          }

          if (text.includes("UPDATE assets") && values) {
            pool.assetRow = {
              ...pool.assetRow,
              asset_state: values[1] as string,
              asset_status: values[2] as string,
              availability_status: values[3] as string,
              review_status: values[4] as string,
              export_status: values[5] as string,
              validation_status: values[6] as string,
              last_updated_at: values[7] as string
            };
          }

          if (text.includes("UPDATE generation_workflows") && values) {
            pool.workflowRow = {
              ...pool.workflowRow,
              generation_status: values[1] as string
            };
          }

          if (text.includes("UPDATE generation_requests") && values) {
            pool.requestRow = {
              ...pool.requestRow,
              last_updated_at: values[3] as string,
              request_status: values[1] as string
            };
          }

          return { rows: [] };
        },
        release() {}
      };
    },
    async query(text: string) {
      if (text.includes("duplicate_part_id")) return { rows: [] };
      if (text.includes("FROM part_source_reconciliations")) return { rows: [] };
      if (text.includes("FROM parts")) return { rows: [buildPartRow()] };
      if (text.includes("FROM part_metrics")) return { rows: [] };
      if (text.includes("FROM assets")) return { rows: [pool.assetRow] };
      if (text.includes("FROM datasheet_revisions")) return { rows: [buildDatasheetRow()] };
      if (text.includes("FROM source_records")) return { rows: [] };
      if (text.includes("FROM source_extraction_signals")) return { rows: [] };
      if (text.includes("FROM mate_relations")) return { rows: [] };
      if (text.includes("FROM accessory_requirements")) return { rows: [] };
      if (text.includes("FROM cable_compatibilities")) return { rows: [] };
      if (text.includes("FROM similar_part_relations")) return { rows: [] };
      if (text.includes("FROM companion_recommendations")) return { rows: [] };
      if (text.includes("FROM generation_workflows")) return { rows: [pool.workflowRow] };
      if (text.includes("FROM generation_requests")) return { rows: [pool.requestRow] };
      if (text.includes("FROM review_records")) return { rows: pool.reviewRows };
      if (text.includes("FROM asset_validation_records")) return { rows: pool.validationRows };
      if (text.includes("FROM asset_promotion_audits")) return { rows: pool.promotionAuditRows };
      if (text.includes("FROM part_issues")) return { rows: [] };
      if (text.includes("FROM part_risk_flags")) return { rows: [] };

      return { rows: [] };
    }
  };

  return pool;
}

/**
 * Builds the joined part row read by catalog-store.
 */
function buildPartRow() {
  return {
    body_height_mm: "2",
    body_length_mm: "4",
    body_width_mm: "5",
    category: "Connector",
    connector_family_description: null,
    connector_family_id: null,
    connector_family_name: null,
    connector_family_series: null,
    lifecycle_status: "active",
    manufacturer_aliases: [],
    manufacturer_id: "mfr-a",
    manufacturer_name: "Manufacturer A",
    manufacturer_website: null,
    mpn: "PART-A",
    package_id: "pkg-a",
    package_name: "Package A",
    part_id: "part-a",
    part_last_updated_at: "2026-04-12T00:00:00.000Z",
    pin_count: 8,
    pitch_mm: "1.27",
    trust_score: "0.8"
  };
}

/**
 * Builds the reviewable generated asset database row.
 */
function buildAssetRow() {
  return {
    asset_state: "downloaded",
    asset_status: "downloaded",
    asset_type: "three_d_model",
    availability_status: "downloaded",
    export_status: "not_exportable",
    file_format: "step",
    file_hash: "sha256:a",
    generation_method: "mechanical_drawing_request",
    generation_source_asset_id: null,
    id: "asset-a-step",
    last_updated_at: "2026-04-12T00:00:00.000Z",
    license_mode: "redistribution_allowed",
    part_id: "part-a",
    preview_status: "pending",
    provider_id: "review-test",
    provenance: "generated",
    review_status: "review_required",
    source_record_id: null,
    source_url: null,
    storage_key: "generated/a.step",
    validation_status: "needs_review"
  };
}

/**
 * Builds validation evidence that qualifies the generated 3D asset for promotion after approval.
 */
function buildValidationRow() {
  return {
    asset_id: "asset-a-step",
    id: "validation-asset-a-step-geometry",
    last_updated_at: "2026-04-13T00:12:00.000Z",
    part_id: "part-a",
    validated_at: "2026-04-13T00:12:00.000Z",
    validation_notes: "3D draft geometry was checked against the mechanical drawing.",
    validation_status: "verified",
    validation_type: "three_d_geometry",
    validator: "api-validation-test"
  };
}

/**
 * Builds the generation workflow database row linked to the reviewable asset.
 */
function buildWorkflowRow() {
  return {
    confidence_score: "0.8",
    generation_status: "review_required",
    id: "gen-a-step",
    output_asset_id: "asset-a-step",
    part_id: "part-a",
    source_asset_id: null,
    source_datasheet_revision_id: "dsr-a",
    target_asset_type: "three_d_model"
  };
}

/**
 * Builds the generation request linked to the reviewable workflow.
 */
function buildRequestRow() {
  return {
    id: "genreq-a-step",
    last_updated_at: "2026-04-12T00:00:00.000Z",
    part_id: "part-a",
    requested_at: "2026-04-12T00:00:00.000Z",
    requested_by: "api-review-test",
    request_status: "review_required",
    source_asset_id: null,
    source_datasheet_revision_id: "dsr-a",
    target_asset_type: "three_d_model",
    workflow_id: "gen-a-step"
  };
}

/**
 * Builds a datasheet row so catalog-store can hydrate the part record.
 */
function buildDatasheetRow() {
  return {
    file_asset_id: null,
    id: "dsr-a",
    last_updated_at: "2026-04-12T00:00:00.000Z",
    page_count: 1,
    parse_confidence: "0.8",
    part_id: "part-a",
    pin_table_status: "available",
    revision_date: "2026-01-01",
    revision_label: "Rev A",
    source_record_id: null
  };
}

/**
 * Invokes the API handler with a tiny in-memory HTTP request/response pair.
 */
async function invokeApiRequest(method: string, url: string, body: unknown, handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>): Promise<{ statusCode: number; body: Record<string, any> }> {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number) {
      statusCode = nextStatusCode;
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { host: "localhost" };
  request.method = method;
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    statusCode
  };
}
