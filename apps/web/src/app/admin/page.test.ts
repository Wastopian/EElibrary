/**
 * File header: Tests admin workspace rendering for review, promotion, and audit operations.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPartRecords } from "@ee-library/shared/search";
import { readCatalogRecordsFromDatabase, setCatalogStorePoolForTests } from "../../../../../apps/api/src/catalog-store";
import { enterRequestContextForTests } from "../../../../../apps/api/src/request-context";
import { persistNormalizedPartRows, persistProviderImportFailureRows } from "../../../../../apps/worker/src/catalog-repository";
import AdminPage from "./page";
import type { Pool } from "pg";
import type { NormalizedProviderPart } from "../../../../../apps/worker/src/provider-adapters";
import type { PartSearchRecord } from "@ee-library/shared/types";

type TestPool = Pool & {
  end: () => Promise<void>;
};

/**
 * Verifies setup-required admin rendering remains explicit when DB-backed catalog data is unavailable.
 */
test("admin workspace renders setup guidance when DB-backed catalog is unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "not_configured",
          objectStorage: "not_connected_phase_0",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    return jsonResponse(
      {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Catalog database is not configured."
        }
      },
      503
    );
  });

  try {
    const html = await renderAdminPage();

    assert.match(html, /Admin workspace/u);
    assert.match(html, /Setup guidance/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.match(html, /EE_LIBRARY_ALLOW_SEED_FALLBACK/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies admin workspace exposes review queue, promotion queue, and audit sections with actionable states.
 */
test("admin workspace renders review, promotion, import, validation, and audit sections", async () => {
  const records = buildAdminFixtureRecords();
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "connected",
          objectStorage: "connected_phase_0",
          queue: "connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    if (url.pathname === "/audit-events") {
      return jsonResponse(buildAuditEventEnvelope());
    }

    return jsonResponse({
      data: records,
      source: "database",
      warnings: []
    });
  });

  try {
    const html = await renderAdminPage();

    assert.match(html, /Import by MPN/u);
    assert.match(html, /Operator import/u);
    assert.match(html, /Approving a part does not make exports available/u);
    assert.match(html, /Queues only appear when there is something in them/u);
    assert.match(html, /Operations queues/u);
    assert.match(html, /Queues for triage, review, verification, approval, issues, imports, and validation/u);
    assert.match(html, /Grouped/u);
    assert.match(html, /Table/u);
    assert.match(html, /Navigate/u);
    assert.match(html, /Assistant triage prep/u);
    assert.match(html, /Assistant output is never trusted automatically/u);
    assert.match(html, /Source evidence needs reconciliation after import failure/u);
    assert.match(html, /Human review required; assistant notes cannot approve, normalize, or promote records/u);
    assert.match(html, /Imports and validation/u);
    assert.match(html, /Verification audit history/u);
    assert.match(html, /Pending approval/u);
    assert.match(html, /Low-confidence identity/u);
    assert.match(html, /Missing verified CAD/u);
    assert.match(html, /Connector coverage gaps/u);
    assert.match(html, /Lifecycle risk/u);
    assert.match(html, /Source conflicts/u);
    assert.match(html, /Review queue/u);
    assert.match(html, /Files to mark verified/u);
    assert.match(html, /Recent imports/u);
    assert.match(html, /Validation evidence summary/u);
    assert.match(html, /CAD trust checks needing attention/u);
    assert.match(html, /Open the part files area and finish engineering review/u);
    assert.match(html, /User action audit trail/u);
    assert.match(html, /project.update/u);
    assert.match(html, /pending review/u);
    assert.match(html, /Ready to verify/u);
    assert.match(html, /Blocked/u);
    assert.match(html, /Failed imports/u);
    assert.match(html, /Generated draft requires explicit review outcome/u);
    assert.doesNotMatch(html, /Duplicate candidates/u);
    assert.doesNotMatch(html, /Unavailable/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies lifecycle and source-conflict queues render from DB-backed API records, not only seeded catalog fixtures.
 */
test("admin workspace renders lifecycle and source-conflict queues from DB-backed records", async () => {
  const pool = createAdminDbBackedPool();
  const client = await pool.connect();

  try {
    await persistNormalizedPartRows(client, buildAdminDbPart({ lastUpdatedAt: "2026-04-16T00:00:00.000Z", lifecycleStatus: "obsolete", mpn: "DB-LIFE-1", partId: "part-db-lifecycle", providerPartKey: "DB-LIFE-1", trustScore: 0.92 }));
    await persistNormalizedPartRows(client, buildAdminDbPart({ lastUpdatedAt: "2026-04-16T01:00:00.000Z", lifecycleStatus: "active", mpn: "DB-SOURCE-1", partId: "part-db-source", providerPartKey: "DB-SOURCE-1", trustScore: 0.91 }));
    await persistProviderImportFailureRows(client, {
      error: new Error("provider timeout"),
      failedAt: "2026-04-16T02:00:00.000Z",
      providerId: "db-admin-provider",
      providerPartKey: "DB-SOURCE-1"
    });
  } finally {
    client.release();
  }

  setCatalogStorePoolForTests(pool);

  try {
    const issueRows = await pool.query<{ issue_code: string; part_id: string }>("SELECT part_id, issue_code FROM part_issues ORDER BY part_id, issue_code");
    const catalogResult = await readCatalogRecordsFromDatabase();

    assert.equal(catalogResult.status, "available");

    if (catalogResult.status !== "available") {
      throw new Error("expected DB-backed admin records");
    }

    assert.equal(issueRows.rows.some((row) => row.part_id === "part-db-lifecycle" && row.issue_code === "lifecycle_risk"), true);
    assert.equal(issueRows.rows.some((row) => row.part_id === "part-db-source" && row.issue_code === "source_conflict"), true);
    assert.equal(catalogResult.records.some((record) => record.issues.some((issue) => issue.code === "lifecycle_risk")), true);
    assert.equal(catalogResult.records.some((record) => record.issues.some((issue) => issue.code === "source_conflict")), true);

    const restoreFetch = mockFetch((url) => {
      if (url.pathname === "/health") {
        return jsonResponse({
          dependencies: {
            database: "connected",
            objectStorage: "connected_phase_0",
            queue: "connected_phase_0"
          },
          service: "api",
          status: "ok"
        });
      }

      if (url.pathname === "/audit-events") {
        return jsonResponse(buildAuditEventEnvelope());
      }

      return jsonResponse({
        data: catalogResult.records,
        source: "database",
        warnings: []
      });
    });

    try {
      const html = await renderAdminPage();

      assert.match(html, /Lifecycle risk/u);
      assert.match(html, /Source conflicts/u);
      assert.match(html, /DB-LIFE-1/u);
      assert.match(html, /DB-SOURCE-1/u);
      assert.match(html, /Failed imports/u);
      assert.match(html, /Error: provider timeout/u);
    } finally {
      restoreFetch();
    }
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

async function renderAdminPage(): Promise<string> {
  return renderToStaticMarkup(await AdminPage({}));
}

function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

function buildAuditEventEnvelope(): Record<string, unknown> {
  return {
    data: {
      boundary: "Audit events record API action metadata only.",
      events: [
        {
          action: "project.update",
          actorId: "admin-fixture",
          actorRole: "admin",
          id: "audit-admin-project-update",
          metadata: { operation: "api-project-update", queryKeys: [] },
          method: "PATCH",
          occurredAt: "2026-04-17T00:00:00.000Z",
          operation: "api-project-update",
          outcome: "succeeded",
          path: "/projects/project-alpha",
          requestId: "audit-request-admin",
          requestIpHash: "hash-ip",
          statusCode: 200,
          targetId: "project-alpha",
          targetType: "project",
          userAgentHash: "hash-ua"
        }
      ],
      state: "available"
    },
    source: "database"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}

function buildAdminFixtureRecords(): PartSearchRecord[] {
  const records = structuredClone(getAllPartRecords()) as PartSearchRecord[];
  const promotableRecord = records.find((record) => record.assets.some((asset) => asset.assetType === "footprint"));
  const blockedRecord = records.find((record) => record.assets.some((asset) => asset.assetType === "symbol")) ?? records[0];
  const reviewRecord = records.find((record) => record.assets.some((asset) => asset.provenance === "generated")) ?? records[0];

  if (!promotableRecord || !blockedRecord || !reviewRecord) {
    return records;
  }

  const promotableAsset = promotableRecord.assets.find((asset) => asset.assetType === "footprint") ?? promotableRecord.assets[0];
  const promotableAssetId = promotableAsset?.id ?? "";
  const blockedAsset = blockedRecord.assets.find((asset) => asset.id !== promotableAssetId && asset.assetType !== "datasheet") ?? blockedRecord.assets[0];
  const reviewAsset = reviewRecord.assets.find((asset) => asset.provenance === "generated") ?? reviewRecord.assets[0];

  if (!promotableAsset || !blockedAsset || !reviewAsset) {
    return records;
  }

  promotableAsset.assetState = "downloaded";
  promotableAsset.assetStatus = "reviewed";
  promotableAsset.availabilityStatus = "downloaded";
  promotableAsset.exportStatus = "not_exportable";
  promotableAsset.fileHash = "sha256:admin-promotable";
  promotableAsset.licenseMode = "redistribution_allowed";
  promotableAsset.reviewStatus = "approved";
  promotableAsset.storageKey = "assets/admin/promotable-footprint";
  promotableAsset.validationStatus = "verified";
  promotableRecord.validationRecords = promotableRecord.validationRecords.filter((record) => record.assetId !== promotableAsset.id);
  promotableRecord.validationRecords.push({
    assetId: promotableAsset.id,
    id: "validation-admin-promotable",
    lastUpdatedAt: "2026-04-15T00:00:00.000Z",
    partId: promotableRecord.part.id,
    validatedAt: "2026-04-15T00:00:00.000Z",
    validationNotes: "Admin fixture qualifying evidence.",
    validationStatus: "verified",
    validationType: "footprint_geometry",
    validator: "admin-fixture"
  });

  blockedAsset.assetState = "downloaded";
  blockedAsset.assetStatus = "reviewed";
  blockedAsset.availabilityStatus = "downloaded";
  blockedAsset.exportStatus = "not_exportable";
  blockedAsset.fileHash = "sha256:admin-blocked";
  blockedAsset.licenseMode = "redistribution_allowed";
  blockedAsset.reviewStatus = "approved";
  blockedAsset.storageKey = "assets/admin/blocked";
  blockedAsset.validationStatus = "needs_review";
  blockedRecord.validationRecords = blockedRecord.validationRecords.filter((record) => record.assetId !== blockedAsset.id);

  reviewAsset.assetState = "downloaded";
  reviewAsset.assetStatus = "downloaded";
  reviewAsset.availabilityStatus = "downloaded";
  reviewAsset.exportStatus = "not_exportable";
  reviewAsset.provenance = "generated";
  reviewAsset.reviewStatus = "review_required";
  reviewAsset.validationStatus = "needs_review";
  reviewAsset.storageKey = reviewAsset.storageKey ?? "assets/admin/generated-review";
  reviewAsset.fileHash = reviewAsset.fileHash ?? "sha256:admin-generated-review";

  const firstSource = reviewRecord.sources[0];
  if (firstSource) {
    firstSource.importStatus = "failed";
    firstSource.importErrorDetails = "Fixture import failure for admin queue test.";
  }

  blockedRecord.issues.push({
    assignedTo: null,
    code: "source_conflict",
    detail: "Provider source health is mixed, so provenance should be reviewed before trusting this record completely.",
    id: "issue-admin-source-conflict",
    lastUpdatedAt: "2026-04-16T00:00:00.000Z",
    partId: blockedRecord.part.id,
    resolutionNotes: null,
    resolvedAt: null,
    severity: "warning",
    source: "admin_fixture",
    status: "open",
    summary: "At least one provider import failed."
  });

  promotableRecord.part.lifecycleStatus = "not_recommended";
  promotableRecord.issues.push({
    assignedTo: null,
    code: "lifecycle_risk",
    detail: "Lifecycle status is not active, so this part should be reviewed carefully before design use.",
    id: "issue-admin-lifecycle-risk",
    lastUpdatedAt: "2026-04-16T00:05:00.000Z",
    partId: promotableRecord.part.id,
    resolutionNotes: null,
    resolvedAt: null,
    severity: "warning",
    source: "admin_fixture",
    status: "open",
    summary: "Lifecycle is not_recommended."
  });
  promotableRecord.riskFlags.push({
    code: "lifecycle_not_active",
    detail: "Lifecycle is not active, so downstream use needs extra review.",
    id: "risk-admin-lifecycle",
    label: "Lifecycle not active",
    lastUpdatedAt: "2026-04-16T00:05:00.000Z",
    partId: promotableRecord.part.id,
    tone: "danger"
  });

  return records;
}

/**
 * Creates a minimal DB-backed catalog schema for admin rendering tests that use real API records.
 */
function createAdminDbBackedPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE manufacturers (id TEXT PRIMARY KEY, name TEXT, aliases TEXT[], website TEXT);
    CREATE TABLE packages (id TEXT PRIMARY KEY, package_name TEXT, pin_count INTEGER, pitch_mm NUMERIC, body_length_mm NUMERIC, body_width_mm NUMERIC, body_height_mm NUMERIC);
    CREATE TABLE connector_families (id TEXT PRIMARY KEY, name TEXT, series TEXT, description TEXT);
    CREATE TABLE parts (id TEXT PRIMARY KEY, mpn TEXT, description TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, org_id TEXT DEFAULT 'org-default', last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_records (id TEXT PRIMARY KEY, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_extraction_signals (id TEXT PRIMARY KEY, part_id TEXT, source_record_id TEXT, datasheet_revision_id TEXT, asset_id TEXT, signal_type TEXT, extraction_status TEXT, confidence_score NUMERIC, extraction_source TEXT, notes TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE assets (id TEXT PRIMARY KEY, part_id TEXT, asset_type TEXT, file_format TEXT, storage_key TEXT, file_hash TEXT, provider_id TEXT, license_mode TEXT, provenance TEXT, availability_status TEXT, review_status TEXT, export_status TEXT, asset_status TEXT, generation_method TEXT, generation_source_asset_id TEXT, validation_status TEXT, preview_status TEXT, preview_artifact_storage_key TEXT, preview_artifact_format TEXT, preview_artifact_generated_at TIMESTAMPTZ, preview_artifact_source TEXT, asset_state TEXT, source_url TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE datasheet_revisions (id TEXT PRIMARY KEY, part_id TEXT, revision_label TEXT, revision_date DATE, page_count INTEGER, file_asset_id TEXT, parse_confidence NUMERIC, pin_table_status TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_metrics (id TEXT PRIMARY KEY, part_id TEXT, metric_key TEXT, metric_value NUMERIC, unit TEXT, min_value NUMERIC, max_value NUMERIC, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_specifications (id TEXT PRIMARY KEY, part_id TEXT, provider_id TEXT, source_record_id TEXT, spec_key TEXT, spec_value TEXT, spec_group TEXT, last_updated_at TIMESTAMPTZ, UNIQUE (part_id, provider_id, spec_key));
    CREATE TABLE part_parameters (id TEXT PRIMARY KEY, part_id TEXT, part_type TEXT, param_key TEXT, value_kind TEXT, value_numeric NUMERIC, value_min NUMERIC, value_max NUMERIC, value_text TEXT, unit TEXT, is_conflicted BOOLEAN, confidence_score NUMERIC, winning_provider_id TEXT, winning_source_record_id TEXT, sources JSONB, last_updated_at TIMESTAMPTZ, UNIQUE (part_id, param_key));
    CREATE TABLE mate_relations (id TEXT PRIMARY KEY, part_id TEXT, mate_part_id TEXT, relationship_type TEXT, compatibility_status TEXT, evidence_kind TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE accessory_requirements (id TEXT PRIMARY KEY, part_id TEXT, accessory_part_id TEXT, relationship_type TEXT, compatibility_status TEXT, evidence_kind TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE cable_compatibilities (id TEXT PRIMARY KEY, part_id TEXT, cable_part_id TEXT, relationship_type TEXT, wire_gauge_min INTEGER, wire_gauge_max INTEGER, shielding_requirement TEXT, termination_style TEXT, compatibility_status TEXT, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, notes TEXT);
    CREATE TABLE connector_family_conflicts (id TEXT PRIMARY KEY, part_id TEXT, candidate_part_id TEXT, candidate_connector_family_id TEXT, conflict_type TEXT, confidence_score NUMERIC, summary TEXT, detail TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ, UNIQUE (part_id, candidate_part_id, conflict_type));
    CREATE TABLE similar_part_relations (id TEXT PRIMARY KEY, part_id TEXT, similar_part_id TEXT, confidence_score NUMERIC, reason TEXT);
    CREATE TABLE companion_recommendations (id TEXT PRIMARY KEY, part_id TEXT, companion_part_id TEXT, confidence_score NUMERIC, usage_context TEXT);
    CREATE TABLE generation_workflows (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, generation_status TEXT, confidence_score NUMERIC, output_asset_id TEXT);
    CREATE TABLE generation_requests (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, request_status TEXT, requested_at TIMESTAMPTZ, requested_by TEXT, workflow_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE review_records (id TEXT PRIMARY KEY, part_id TEXT, target_type TEXT, asset_id TEXT, generation_workflow_id TEXT, outcome TEXT, reviewer TEXT, notes TEXT, reviewed_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_validation_records (id TEXT PRIMARY KEY, part_id TEXT, asset_id TEXT, validation_status TEXT, validation_type TEXT, validation_notes TEXT, validated_at TIMESTAMPTZ, validator TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE asset_promotion_audits (id TEXT PRIMARY KEY, part_id TEXT, asset_id TEXT, prior_export_status TEXT, new_export_status TEXT, promotion_outcome TEXT, blocker_reasons TEXT[], validation_record_id TEXT, actor TEXT, created_at TIMESTAMPTZ);
    CREATE TABLE part_readiness_summaries (part_id TEXT PRIMARY KEY, readiness_status TEXT, identity_status TEXT, connector_class TEXT, blocker_count INTEGER, blocker_summary TEXT[], recommended_actions TEXT[], detail TEXT, last_evaluated_at TIMESTAMPTZ);
    CREATE TABLE part_approvals (part_id TEXT PRIMARY KEY, approval_status TEXT, summary TEXT, detail TEXT, evidence TEXT[], decided_by TEXT, decided_at TIMESTAMPTZ, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_issues (id TEXT PRIMARY KEY, part_id TEXT, issue_code TEXT, severity TEXT, status TEXT, assigned_to TEXT, resolution_notes TEXT, resolved_at TIMESTAMPTZ, summary TEXT, detail TEXT, source TEXT, last_updated_at TIMESTAMPTZ, UNIQUE (part_id, issue_code));
    CREATE TABLE part_source_reconciliations (part_id TEXT PRIMARY KEY, preferred_source_record_id TEXT, resolution_status TEXT, notes TEXT, updated_by TEXT, updated_at TIMESTAMPTZ);
    CREATE TABLE part_risk_flags (id TEXT PRIMARY KEY, part_id TEXT, risk_code TEXT, label TEXT, detail TEXT, tone TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE supply_offerings (id TEXT PRIMARY KEY, part_id TEXT, provider_id TEXT, source_record_id TEXT, provider_part_key TEXT, supplier_name TEXT, provider_sku TEXT, inventory_status TEXT, inventory_quantity INTEGER, moq INTEGER, lead_time_days INTEGER, packaging TEXT, currency_code TEXT, preferred_rank INTEGER, last_seen_at TIMESTAMPTZ, retired_at TIMESTAMPTZ, retirement_reason TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
    CREATE TABLE price_breaks (id TEXT PRIMARY KEY, supply_offering_id TEXT, min_quantity INTEGER, unit_price NUMERIC, currency_code TEXT, captured_at TIMESTAMPTZ);

    -- Tenant isolation (2c): part-attached children carry org_id (connector_family_conflicts stays global).
    ALTER TABLE source_records ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE source_extraction_signals ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE assets ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE datasheet_revisions ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_metrics ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_specifications ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_parameters ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE mate_relations ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE accessory_requirements ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE cable_compatibilities ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE similar_part_relations ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE companion_recommendations ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE generation_workflows ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE generation_requests ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE review_records ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE asset_validation_records ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE asset_promotion_audits ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_readiness_summaries ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_approvals ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_issues ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_source_reconciliations ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE part_risk_flags ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE supply_offerings ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE price_breaks ADD COLUMN org_id TEXT DEFAULT 'org-default';
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  // The admin page reads the tenant-scoped catalog directly; render as an org-default teammate.
  enterRequestContextForTests("org-default");

  return new MemoryPool() as TestPool;
}

/**
 * Builds one small provider-neutral part payload for DB-backed admin tests.
 */
function buildAdminDbPart(config: {
  lastUpdatedAt: string;
  lifecycleStatus: NormalizedProviderPart["part"]["lifecycleStatus"];
  mpn: string;
  partId: string;
  providerPartKey: string;
  trustScore: number;
}): NormalizedProviderPart {
  return {
    accessoryRequirements: [],
    assets: [],
    cableCompatibilities: [],
    companionRecommendations: [],
    connectorFamily: null,
    connectorFamilyConflicts: [],
    datasheetRevisions: [],
    generationWorkflows: [],
    extractionSignals: [],
    promotionAudits: [],
    manufacturer: {
      aliases: [],
      id: `mfr-${config.partId}`,
      name: `Manufacturer ${config.mpn}`,
      website: null
    },
    mateRelations: [],
    metrics: [],
    package: {
      bodyHeightMm: null,
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: `pkg-${config.partId}`,
      packageName: "0402",
      pinCount: 2,
      pitchMm: null
    },
    part: {
      category: "Resistors / Chip Resistor - Surface Mount",
      connectorFamilyId: null,
      description: "",
      id: config.partId,
      lastUpdatedAt: config.lastUpdatedAt,
      lifecycleStatus: config.lifecycleStatus,
      manufacturerId: `mfr-${config.partId}`,
      mpn: config.mpn,
      packageId: `pkg-${config.partId}`,
      trustScore: config.trustScore
    },
    reviewRecords: [],
    validationRecords: [],
    similarPartRelations: [],
    supplyOfferings: [],
    sourceRecord: {
      fetchedAt: config.lastUpdatedAt,
      id: `source-db-admin-provider-${config.providerPartKey.toLowerCase()}`,
      importErrorDetails: null,
      importStatus: "imported",
      lastUpdatedAt: config.lastUpdatedAt,
      normalizedAt: config.lastUpdatedAt,
      partId: config.partId,
      providerId: "db-admin-provider",
      providerPartKey: config.providerPartKey,
      rawPayload: { providerPartKey: config.providerPartKey },
      sourceLastImportedAt: config.lastUpdatedAt,
      sourceLastSeenAt: config.lastUpdatedAt,
      sourceUrl: `https://example.test/${config.providerPartKey.toLowerCase()}`
    }
  };
}
