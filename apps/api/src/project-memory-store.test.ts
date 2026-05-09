/**
 * File header: Tests project/BOM memory read contracts and HTTP routes.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  applyApprovalBatchInDatabase,
  createExportBundleInDatabase,
  resolveExportBundleFileAvailability,
  createBomImportInDatabase,
  createCircuitBlockInDatabase,
  createCircuitBlockPartInDatabase,
  createEvidenceAttachmentInDatabase,
  createProjectInDatabase,
  matchBomImportRowsInDatabase,
  readApprovalBatchCandidatesFromDatabase,
  readCircuitBlockDetailFromDatabase,
  readCircuitBlockFollowUpsFromDatabase,
  readCircuitBlocksFromDatabase,
  readConnectorSetCatalogFromDatabase,
  readEvidenceAttachmentsFromDatabase,
  createPartSubstitutionInDatabase,
  instantiateCircuitBlockIntoProjectBomInDatabase,
  readBomImportDiagnosticsFromDatabase,
  readPartSubstitutionsForPartFromDatabase,
  readPartWhereUsedFromDatabase,
  readProjectBomHealthFromDatabase,
  readProjectDetailFromDatabase,
  readProjectEvidenceAttachmentsFromDatabase,
  readProjectFleetRiskFromDatabase,
  readProjectFollowUpsFromDatabase,
  readProjectRevisionCompareFromDatabase,
  readProjectsFromDatabase,
  revokePartSubstitutionInDatabase,
  readWhereUsedSearchFromDatabase,
  setProjectMemoryStorePoolForTests,
  syncCircuitBlockFollowUpsFromReadinessInDatabase,
  syncProjectFollowUpsFromBomHealthInDatabase,
  updateCircuitBlockInDatabase,
  updateCircuitBlockPartInDatabase,
  updateEvidenceAttachmentInDatabase,
  updateFollowUpInDatabase,
  updateProjectInDatabase,
  updateProjectRevisionInDatabase
} from "./project-memory-store";
import { setStorageClientForTests } from "./file-storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

/** TestPool is the pg-mem pool shape used by project-memory tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after each test releases it. */
  end: () => Promise<void>;
};

/**
 * Verifies project-memory reads do not pretend to work without configured persistence.
 */
test("readProjectsFromDatabase returns not_configured without a project-memory database", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  setProjectMemoryStorePoolForTests(null);

  try {
    const result = await readProjectsFromDatabase();

    assert.equal(result.status, "not_configured");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    restoreDatabaseUrl(previousDatabaseUrl);
  }
});

/**
 * Verifies a configured but empty project-memory database reports an empty state.
 */
test("readProjectsFromDatabase returns an empty state from configured empty project tables", async () => {
  const pool = createProjectMemoryPool(false);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectsFromDatabase();

    assert.equal(result.status, "available");
    assert.equal(result.response.state, "empty");
    assert.deepEqual(result.response.projects, []);
    assert.equal(result.response.capabilities.find((capability) => capability.id === "bom_upload")?.state, "foundation");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies persisted BOM rows and confirmed usage stay separate from weak matches.
 */
test("project memory store exposes project detail without promoting weak BOM lines", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectDetailFromDatabase("project-alpha");

    assert.equal(result.status, "available");
    assert.equal(result.response.project.projectKey, "ALPHA");
    assert.equal(result.response.summary.revisionCount, 1);
    assert.equal(result.response.summary.bomImportCount, 1);
    assert.equal(result.response.summary.usageCount, 1);
    assert.equal(result.response.revisions[0]?.revisionLabel, "A");
    assert.equal(result.response.bomImports[0]?.sourceFilename, "alpha-bom.csv");
    assert.equal(result.response.usages.length, 1);
    assert.equal(result.response.usages[0]?.partId, "part-memory-ldo");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies part where-used reads join confirmed usage to project and revision context.
 */
test("project memory store exposes where-used context for confirmed part usage", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readPartWhereUsedFromDatabase("part-memory-ldo");

    assert.equal(result.status, "available");
    assert.equal(result.response.state, "available");
    assert.equal(result.response.usages.length, 1);
    assert.equal(result.response.usages[0]?.project.projectKey, "ALPHA");
    assert.equal(result.response.usages[0]?.projectRevision.revisionLabel, "A");
    assert.deepEqual(result.response.usages[0]?.usage.designators, ["U1"]);
    assert.equal(result.response.usages[0]?.usage.quantity, 1);
    assert.equal(result.response.usages[0]?.bomLine?.rowNumber, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies existing parts without confirmed usage report a scoped empty where-used state.
 */
test("project memory store returns empty where-used state for unused parts", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readPartWhereUsedFromDatabase("part-memory-resistor");

    assert.equal(result.status, "available");
    assert.equal(result.response.state, "empty");
    assert.deepEqual(result.response.usages, []);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies BOM health counts are derived from concrete BOM rows, part state, CAD truth, and evidence.
 */
test("project memory store derives explainable BOM health from fixture rows", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(result.status, "available");
    assert.equal(result.response.summary.totalLineCount, 2);
    assert.equal(result.response.summary.matchedLineCount, 1);
    assert.equal(result.response.summary.weakMatchLineCount, 1);
    assert.equal(result.response.summary.unmatchedLineCount, 0);
    assert.equal(result.response.summary.approvalGapCount, 0);
    assert.equal(result.response.summary.lifecycleRiskCount, 0);
    assert.equal(result.response.summary.missingVerifiedCadCount, 1);
    assert.equal(result.response.summary.referencedCadOnlyCount, 1);
    assert.equal(result.response.summary.missingEvidenceCount, 1);
    assert.equal(result.response.findings.some((finding) => finding.code === "missing_verified_cad"), true);
    assert.equal(result.response.findings.some((finding) => finding.inputs.some((input) => /referencedCad=1/u.test(input))), true);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies lifecycle regression findings compare current catalog touch time against resolved BOM health follow-ups.
 */
test("project memory store surfaces lifecycle_risk_changed when catalog moves after a BOM health review checkpoint", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const baseline = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(baseline.status, "available");
    assert.equal(baseline.response.lifecycleReviewCheckpointAt, null);
    assert.equal(baseline.response.summary.lifecycleRegressionCount, 0);
    assert.equal(baseline.response.findings.some((finding) => finding.code === "lifecycle_risk_changed"), false);

    await pool.query(`
      INSERT INTO follow_up_records (
        id, target_type, target_id, source_type, source_finding_id, title, detail, next_action, severity, status,
        source_inputs, evidence_attachment_ids, resolution_notes, resolved_at, created_at, updated_at
      )
      VALUES (
        'followup-alpha-checkpoint',
        'project',
        'project-alpha',
        'bom_health',
        'project-alpha:bom-health:approval_gap',
        'Checkpoint',
        'Fixture resolved follow-up to anchor lifecycle regression timing.',
        'Close',
        'review',
        'resolved',
        '[]'::jsonb,
        '[]'::jsonb,
        'Fixture BOM health review complete.',
        '2026-05-15T12:00:00.000Z',
        '2026-05-10T00:00:00.000Z',
        '2026-05-15T12:00:00.000Z'
      )
    `);

    await pool.query(`
      UPDATE parts
      SET lifecycle_status = 'not_recommended', last_updated_at = '2026-06-01T08:00:00.000Z'
      WHERE id = 'part-memory-ldo'
    `);

    const regressed = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(regressed.status, "available");
    assert.equal(regressed.response.lifecycleReviewCheckpointAt, "2026-05-15T12:00:00.000Z");
    assert.equal(regressed.response.summary.lifecycleRegressionCount, 1);
    assert.equal(regressed.response.findings.some((finding) => finding.code === "lifecycle_risk_changed"), true);
    const regression = regressed.response.findings.find((finding) => finding.code === "lifecycle_risk_changed");
    assert.equal(regression?.affectedBomLineIds.includes("line-alpha-1"), true);
    assert.match(regression?.detail ?? "", /2026-05-15T12:00:00\.000Z/u);

    await pool.query(`
      UPDATE parts
      SET last_updated_at = '2026-05-10T08:00:00.000Z'
      WHERE id = 'part-memory-ldo'
    `);

    const cleared = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(cleared.status, "available");
    assert.equal(cleared.response.summary.lifecycleRegressionCount, 0);
    assert.equal(cleared.response.findings.some((finding) => finding.code === "lifecycle_risk_changed"), false);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies evidence metadata can attach to supported targets without changing approval or export health.
 */
test("project memory store persists evidence attachments without altering approval or export readiness", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const before = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(before.status, "available");
    assert.equal(before.response.summary.missingVerifiedCadCount, 1);
    assert.equal(before.response.summary.missingEvidenceCount, 1);

    const projectEvidence = await createEvidenceAttachmentInDatabase(
      {
        evidenceType: "link",
        sourceUrl: "https://example.test/design-review",
        targetId: "project-alpha",
        targetType: "project",
        title: "Design review"
      },
      "test-admin"
    );
    const lineEvidence = await createEvidenceAttachmentInDatabase(
      {
        evidenceType: "note",
        notes: "Reviewed U1 regulator use during fixture bring-up.",
        targetId: "line-alpha-1",
        targetType: "bom_line",
        title: "U1 usage note"
      },
      "test-admin"
    );

    assert.equal(projectEvidence.status, "created");
    assert.equal(projectEvidence.response.attachment.reviewStatus, "unreviewed");
    assert.equal(lineEvidence.status, "created");
    assert.equal(lineEvidence.response.attachment.targetType, "bom_line");

    const evidence = await readProjectEvidenceAttachmentsFromDatabase("project-alpha");
    const after = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(evidence.status, "available");
    assert.equal(evidence.response.attachments.length, 2);
    assert.equal(after.status, "available");
    assert.equal(after.response.summary.evidenceAttachmentCount, 2);
    assert.equal(after.response.summary.missingEvidenceCount, 0);
    assert.equal(after.response.summary.approvalGapCount, 0);
    assert.equal(after.response.summary.missingVerifiedCadCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies evidence vault filters and review edits remain provenance-only metadata.
 */
test("project memory store lists and reviews evidence vault rows without changing target trust", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const linkEvidence = await createEvidenceAttachmentInDatabase(
      {
        evidenceType: "link",
        provenance: "manual_internal",
        sourceUrl: "https://example.test/design-review",
        targetId: "project-alpha",
        targetType: "project",
        title: "Design review"
      },
      "test-admin"
    );
    const fileEvidence = await createEvidenceAttachmentInDatabase(
      {
        evidenceType: "file",
        fileHash: "abc123",
        mimeType: "application/pdf",
        provenance: "manual_internal",
        storageKey: "evidence/project/project-alpha/abc123-review.pdf",
        targetId: "project-alpha",
        targetType: "project",
        title: "Review PDF"
      },
      "test-admin"
    );

    assert.equal(linkEvidence.status, "created");
    assert.equal(fileEvidence.status, "created");

    const fileBacked = await readEvidenceAttachmentsFromDatabase({ storageState: "file_backed" });
    const linkOnly = await readEvidenceAttachmentsFromDatabase({ evidenceType: "link", reviewStatus: "unreviewed", sourceSystem: "manual_internal" });
    const update = linkEvidence.status === "created" ? await updateEvidenceAttachmentInDatabase(linkEvidence.response.attachment.id, {
      notes: "Reviewed as useful context only.",
      reviewStatus: "accepted"
    }) : null;
    const reviewed = await readEvidenceAttachmentsFromDatabase({ reviewStatus: "accepted" });
    const health = await readProjectBomHealthFromDatabase("project-alpha");

    assert.equal(fileBacked.status, "available");
    assert.equal(fileBacked.response.summary.fileBackedCount, 1);
    assert.equal(fileBacked.response.attachments[0]?.storageKey, "evidence/project/project-alpha/abc123-review.pdf");
    assert.equal(linkOnly.status, "available");
    assert.equal(linkOnly.response.summary.linkOnlyCount, 1);
    assert.equal(update?.status, "updated");
    assert.equal(reviewed.status, "available");
    assert.equal(reviewed.response.attachments[0]?.reviewStatus, "accepted");
    assert.equal(health.status, "available");
    assert.equal(health.response.summary.missingVerifiedCadCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies computed BOM and circuit gaps can become owned follow-up records.
 */
test("project memory store syncs and updates follow-up records without altering readiness", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const evidence = await createEvidenceAttachmentInDatabase(
      {
        evidenceType: "note",
        notes: "CAD review follow-up context.",
        targetId: "project-alpha",
        targetType: "project",
        title: "Follow-up context"
      },
      "test-admin"
    );
    const projectSync = await syncProjectFollowUpsFromBomHealthInDatabase("project-alpha");
    const projectFollowUps = await readProjectFollowUpsFromDatabase("project-alpha");

    assert.equal(projectSync.status, "synced");
    assert.equal(projectSync.response.createdCount > 0, true);
    assert.equal(projectFollowUps.status, "available");
    assert.equal(projectFollowUps.response.followUps.some((followUp) => followUp.sourceType === "bom_health"), true);

    const firstProjectFollowUp = projectFollowUps.status === "available" ? projectFollowUps.response.followUps[0] : null;
    const evidenceId = evidence.status === "created" ? evidence.response.attachment.id : "";
    const projectUpdate = firstProjectFollowUp ? await updateFollowUpInDatabase(firstProjectFollowUp.id, {
      assignedTo: "hardware",
      evidenceAttachmentIds: [evidenceId],
      resolutionNotes: "Assigned for CAD evidence review.",
      status: "in_progress"
    }) : null;
    const projectResync = await syncProjectFollowUpsFromBomHealthInDatabase("project-alpha");

    assert.equal(projectUpdate?.status, "updated");
    assert.equal(projectUpdate?.response.followUp.assignedTo, "hardware");
    assert.deepEqual(projectUpdate?.response.followUp.evidenceAttachmentIds, [evidenceId]);
    assert.equal(projectResync.status, "synced");
    assert.equal(projectResync.response.createdCount, 0);
    assert.equal(projectResync.response.followUps.find((followUp) => followUp.id === firstProjectFollowUp?.id)?.status, "in_progress");

    const circuitSync = await syncCircuitBlockFollowUpsFromReadinessInDatabase("cblock-alpha-power");
    const circuitFollowUps = await readCircuitBlockFollowUpsFromDatabase("cblock-alpha-power");
    const circuitDetail = await readCircuitBlockDetailFromDatabase("cblock-alpha-power");

    assert.equal(circuitSync.status, "synced");
    assert.equal(circuitSync.response.createdCount, 1);
    assert.equal(circuitFollowUps.status, "available");
    assert.equal(circuitFollowUps.response.followUps[0]?.sourceType, "circuit_block_gap");
    assert.equal(circuitDetail.status, "available");
    assert.equal(circuitDetail.response.parts[0]?.part.readinessStatus, "needs_attention");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies circuit block reads preserve linked-part readiness instead of inheriting block status.
 */
test("project memory store exposes circuit block library and linked part readiness", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const list = await readCircuitBlocksFromDatabase();
    const detail = await readCircuitBlockDetailFromDatabase("cblock-alpha-power");

    assert.equal(list.status, "available");
    assert.equal(list.response.state, "available");
    assert.equal(list.response.circuitBlocks[0]?.circuitBlock.blockKey, "ALPHA-POWER");
    assert.equal(list.response.circuitBlocks[0]?.circuitBlock.status, "approved");
    assert.equal(list.response.circuitBlocks[0]?.requiredPartCount, 1);
    assert.equal(list.response.circuitBlocks[0]?.readinessGapCount, 1);

    assert.equal(detail.status, "available");
    assert.equal(detail.response.parts[0]?.blockPart.role, "Main LDO");
    assert.equal(detail.response.parts[0]?.part.approvalStatus, "approved");
    assert.equal(detail.response.parts[0]?.part.readinessStatus, "needs_attention");
    assert.match(detail.response.boundary, /approval, readiness, validation, and export/u);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies global where-used search joins project usage and circuit block dependencies.
 */
test("project memory store exposes global where-used search for parts and circuit blocks", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const partSearch = await readWhereUsedSearchFromDatabase("part", "TPS7A02DBVR");
    const blockSearch = await readWhereUsedSearchFromDatabase("circuit_block", "ALPHA-POWER");
    const unsupportedSearch = await readWhereUsedSearchFromDatabase("asset", "asset-memory-ldo-symbol-ref");

    assert.equal(partSearch.status, "available");
    assert.equal(partSearch.response.state, "available");
    assert.equal(partSearch.response.matchedParts[0]?.partId, "part-memory-ldo");
    assert.equal(partSearch.response.projectUsages[0]?.project.projectKey, "ALPHA");
    assert.equal(partSearch.response.circuitBlockDependencies[0]?.blockPart.role, "Main LDO");
    assert.equal(partSearch.response.projectUsages[0]?.blockPart, null);

    assert.equal(blockSearch.status, "available");
    assert.equal(blockSearch.response.matchedCircuitBlocks[0]?.circuitBlock.blockKey, "ALPHA-POWER");
    assert.equal(blockSearch.response.circuitBlockDependencies[0]?.part.mpn, "TPS7A02DBVR");
    assert.equal(blockSearch.response.projectUsages[0]?.blockPart?.role, "Main LDO");
    assert.equal(blockSearch.response.projectUsages[0]?.usage.designators[0], "U1");
    assert.match(blockSearch.response.boundary, /do not approve reuse/u);

    assert.equal(unsupportedSearch.status, "available");
    assert.equal(unsupportedSearch.response.supportedTarget, true);
    assert.equal(unsupportedSearch.response.state, "empty");
    assert.equal(unsupportedSearch.response.unsupportedReason, null);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies circuit block writes and evidence attachments preserve reusable circuit context.
 */
test("project memory store creates circuit blocks, part roles, and block evidence", async () => {
  const pool = createProjectMemoryPool(false);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const block = await createCircuitBlockInDatabase({
      blockKey: "USB-PROTECT",
      blockType: "protection",
      constraints: { note: "Use near connector entry." },
      name: "USB input protection",
      owner: "hardware",
      reuseScope: "USB device ports",
      status: "in_review"
    });

    assert.equal(block.status, "created");
    assert.equal(block.response.circuitBlock.id, "cblock-usb-protect");
    assert.equal(block.response.detail.summary.totalPartCount, 0);

    const role = await createCircuitBlockPartInDatabase("cblock-usb-protect", {
      isRequired: true,
      notes: "Reference ESD protector role.",
      partId: "part-memory-resistor",
      quantity: 2,
      role: "Input damping",
      substitutionPolicy: "approved_alternate_allowed"
    });

    assert.equal(role.status, "created");
    assert.equal(role.response.circuitBlockPart.circuitBlockId, "cblock-usb-protect");
    assert.equal(role.response.detail.summary.totalPartCount, 1);
    assert.equal(role.response.detail.parts[0]?.part.mpn, "RC0603FR-0710KL");

    const evidence = await createEvidenceAttachmentInDatabase(
      {
        evidenceType: "link",
        sourceUrl: "https://example.test/usb-review",
        targetId: "cblock-usb-protect",
        targetType: "circuit_block",
        title: "USB review"
      },
      "test-admin"
    );
    const detail = await readCircuitBlockDetailFromDatabase("cblock-usb-protect");

    assert.equal(evidence.status, "created");
    assert.equal(evidence.response.attachment.targetType, "circuit_block");
    assert.equal(detail.status, "available");
    assert.equal(detail.response.evidence.length, 1);
    assert.equal(detail.response.summary.evidenceAttachmentCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies editable project and circuit metadata stays separate from trust and usage records.
 */
test("project memory store updates project and circuit metadata without altering readiness truth", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const projectUpdate = await updateProjectInDatabase("project-alpha", {
      description: "Edited project notes.",
      name: "Alpha Controller Edited",
      owner: "sustaining",
      status: "production"
    });
    const revisionUpdate = await updateProjectRevisionInDatabase("project-alpha", "rev-alpha-a", {
      releasedAt: "2026-05-02T12:00:00.000Z",
      revisionStatus: "released",
      sourceReference: "ECO-42"
    });
    const blockUpdate = await updateCircuitBlockInDatabase("cblock-alpha-power", {
      blockType: "power",
      constraints: { note: "Updated layout note." },
      description: "Edited reusable LDO rail.",
      name: "Alpha edited power rail",
      owner: "sustaining",
      reuseScope: "Released alpha boards",
      status: "restricted"
    });
    const roleUpdate = await updateCircuitBlockPartInDatabase("cblock-alpha-power", "cbpart-alpha-power-ldo", {
      isRequired: false,
      notes: "Optional in low-power variants.",
      quantity: 2,
      substitutionPolicy: "do_not_substitute"
    });

    assert.equal(projectUpdate.status, "updated");
    assert.equal(projectUpdate.response.project.status, "production");
    assert.equal(projectUpdate.response.detail.summary.usageCount, 1);
    assert.match(projectUpdate.response.boundary, /do not approve parts/u);

    assert.equal(revisionUpdate.status, "updated");
    assert.equal(revisionUpdate.response.revision.revisionStatus, "released");
    assert.equal(revisionUpdate.response.revision.sourceReference, "ECO-42");
    assert.equal(revisionUpdate.response.detail.bomImports.length, 1);

    assert.equal(blockUpdate.status, "updated");
    assert.equal(blockUpdate.response.circuitBlock.status, "restricted");
    assert.equal(blockUpdate.response.detail.parts[0]?.part.approvalStatus, "approved");
    assert.equal(blockUpdate.response.detail.parts[0]?.part.readinessStatus, "needs_attention");

    assert.equal(roleUpdate.status, "updated");
    assert.equal(roleUpdate.response.circuitBlockPart.isRequired, false);
    assert.equal(roleUpdate.response.circuitBlockPart.substitutionPolicy, "do_not_substitute");
    assert.equal(roleUpdate.response.detail.summary.requiredPartCount, 0);
    assert.equal(roleUpdate.response.detail.summary.totalPartCount, 1);
    assert.match(roleUpdate.response.boundary, /does not approve the part/u);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies project creation writes a project and initial revision for site workflows.
 */
test("project memory store creates a project and first revision", async () => {
  const pool = createProjectMemoryPool(false);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await createProjectInDatabase({
      initialRevisionLabel: "Rev A",
      name: "Beta Driver",
      owner: "hardware",
      projectKey: "BETA",
      status: "prototype"
    });

    assert.equal(result.status, "created");
    assert.equal(result.response.project.id, "project-beta");
    assert.equal(result.response.initialRevision.revisionLabel, "Rev A");
    assert.equal(result.response.detail.summary.revisionCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies mapped BOM import persistence keeps rows unmatched and preserves raw payloads.
 */
test("project memory store persists mapped CSV BOM lines without creating usage", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await createBomImportInDatabase(
      "project-alpha",
      {
        columnMapping: {
          designators: "Refs",
          manufacturer: "Maker",
          mpn: "MPN",
          quantity: "Qty"
        },
        projectRevisionId: "rev-alpha-a",
        rawContent: "Refs,MPN,Maker,Qty\nU2 U3,TPS7A02DBVR,Texas Instruments,2\n\nR5,RC0603FR-0710KL,Yageo,1\n",
        sourceFilename: "alpha-upload.csv",
        sourceFormat: "csv"
      },
      "test-admin"
    );

    assert.equal(result.status, "created");
    assert.equal(result.response.lineCount, 2);
    assert.equal(result.response.summary.skippedBlankRowCount, 1);
    assert.equal(result.response.linesPreview[0]?.matchStatus, "unmatched");
    assert.deepEqual(result.response.linesPreview[0]?.designators, ["U2", "U3"]);
    assert.equal(result.response.linesPreview[0]?.rawRowPayload.MPN, "TPS7A02DBVR");

    const detail = await readProjectDetailFromDatabase("project-alpha");

    assert.equal(detail.status, "available");
    assert.equal(detail.response.summary.bomImportCount, 2);
    assert.equal(detail.response.summary.usageCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies exact internal matching creates usage while weak and ambiguous rows stay out of history.
 */
test("project memory store matches BOM rows and creates usage only for confirmed exact manufacturer matches", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const created = await createBomImportInDatabase(
      "project-alpha",
      {
        columnMapping: {
          designators: "Refs",
          manufacturer: "Maker",
          mpn: "MPN",
          quantity: "Qty"
        },
        projectRevisionId: "rev-alpha-a",
        rawContent: [
          "Refs,MPN,Maker,Qty",
          "U2,TPS7A02DBVR,Texas Instruments,1",
          "U3,TPS7A02DBVR,,1",
          "U4,DUP-123,,1",
          "U5,NOT-REAL,Acme,1",
          "R2,RC0603FR-0710KL,Yageo,1"
        ].join("\n"),
        sourceFilename: "alpha-match.csv",
        sourceFormat: "csv"
      },
      "test-admin"
    );

    assert.equal(created.status, "created");

    const match = await matchBomImportRowsInDatabase(created.response.bomImport.id);

    assert.equal(match.status, "matched");
    assert.equal(match.response.summary.totalLineCount, 5);
    assert.equal(match.response.summary.matchedLineCount, 2);
    assert.equal(match.response.summary.weakMatchLineCount, 1);
    assert.equal(match.response.summary.ambiguousLineCount, 1);
    assert.equal(match.response.summary.unmatchedLineCount, 1);
    assert.equal(match.response.summary.usageCreatedOrUpdatedCount, 2);
    assert.equal(match.response.importCandidates[0]?.mpn, "NOT-REAL");
    assert.equal(match.response.linesPreview.find((line) => line.rawMpn === "TPS7A02DBVR" && !line.rawManufacturer)?.matchStatus, "weak_match");
    assert.equal(match.response.linesPreview.find((line) => line.rawMpn === "DUP-123")?.matchStatus, "ambiguous");
    assert.equal(match.response.linesPreview.find((line) => line.rawMpn === "NOT-REAL")?.matchStatus, "unmatched");
    assert.equal(match.response.usagesPreview.some((usage) => usage.partId === "part-memory-ldo"), true);

    const detail = await readProjectDetailFromDatabase("project-alpha");

    assert.equal(detail.status, "available");
    assert.equal(detail.response.summary.usageCount, 3);

    const rerun = await matchBomImportRowsInDatabase(created.response.bomImport.id);
    const detailAfterRerun = await readProjectDetailFromDatabase("project-alpha");

    assert.equal(rerun.status, "matched");
    assert.equal(detailAfterRerun.status, "available");
    assert.equal(detailAfterRerun.response.summary.usageCount, 3);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies project-memory API routes return typed database envelopes and honest planned states.
 */
test("project memory routes return project, BOM line, and usage read contracts", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProjectMemoryPool(true);
  process.env.NODE_ENV = "test";
  setProjectMemoryStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    const list = await invokeApiGet("/projects", handleRequest);
    const detail = await invokeApiGet("/projects/project-alpha", handleRequest);
    const usages = await invokeApiGet("/projects/project-alpha/usages", handleRequest);
    const bomHealth = await invokeApiGet("/projects/project-alpha/bom-health", handleRequest);
    const evidence = await invokeApiGet("/projects/project-alpha/evidence", handleRequest);
    const evidenceVault = await invokeApiGet("/evidence-attachments?targetType=project&reviewStatus=unreviewed", handleRequest);
    const projectFollowUps = await invokeApiGet("/projects/project-alpha/follow-ups", handleRequest);
    const circuitBlocks = await invokeApiGet("/circuit-blocks", handleRequest);
    const circuitBlockDetail = await invokeApiGet("/circuit-blocks/cblock-alpha-power", handleRequest);
    const circuitFollowUps = await invokeApiGet("/circuit-blocks/cblock-alpha-power/follow-ups", handleRequest);
    const whereUsed = await invokeApiGet("/parts/part-memory-ldo/usages", handleRequest);
    const globalWhereUsed = await invokeApiGet("/where-used?targetType=circuit_block&q=ALPHA-POWER", handleRequest);
    const plannedWhereUsed = await invokeApiGet("/where-used?targetType=connector_set&q=alpha", handleRequest);
    const lines = await invokeApiGet("/bom-imports/bom-alpha-a/lines", handleRequest);
    const missing = await invokeApiGet("/projects/project-missing", handleRequest);

    assert.equal(list.statusCode, 200);
    assert.equal(list.headers["X-EE-Operation"], "api-project-list");
    assert.equal(list.body.source, "database");
    assert.equal(list.body.data.projects[0]?.project.projectKey, "ALPHA");
    assert.equal(list.body.data.capabilities.find((capability: any) => capability.id === "bom_matching")?.state, "foundation");

    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.data.project.id, "project-alpha");
    assert.equal(detail.body.data.usages.length, 1);

    assert.equal(usages.statusCode, 200);
    assert.equal(usages.body.data.usages[0]?.partId, "part-memory-ldo");

    assert.equal(bomHealth.statusCode, 200);
    assert.equal(bomHealth.headers["X-EE-Operation"], "api-project-bom-health");
    assert.equal(bomHealth.body.data.summary.missingVerifiedCadCount, 1);
    assert.equal(bomHealth.body.data.findings.some((finding: any) => finding.code === "missing_verified_cad"), true);

    assert.equal(evidence.statusCode, 200);
    assert.equal(evidence.headers["X-EE-Operation"], "api-project-evidence");
    assert.equal(evidence.body.data.state, "empty");

    assert.equal(evidenceVault.statusCode, 200);
    assert.equal(evidenceVault.headers["X-EE-Operation"], "api-evidence-attachments");
    assert.equal(evidenceVault.body.data.state, "empty");

    assert.equal(projectFollowUps.statusCode, 200);
    assert.equal(projectFollowUps.headers["X-EE-Operation"], "api-project-follow-ups");
    assert.equal(projectFollowUps.body.data.state, "empty");

    assert.equal(circuitBlocks.statusCode, 200);
    assert.equal(circuitBlocks.headers["X-EE-Operation"], "api-circuit-block-list");
    assert.equal(circuitBlocks.body.data.circuitBlocks[0]?.circuitBlock.blockKey, "ALPHA-POWER");

    assert.equal(circuitBlockDetail.statusCode, 200);
    assert.equal(circuitBlockDetail.headers["X-EE-Operation"], "api-circuit-block-detail");
    assert.equal(circuitBlockDetail.body.data.parts[0]?.part.readinessStatus, "needs_attention");

    assert.equal(circuitFollowUps.statusCode, 200);
    assert.equal(circuitFollowUps.headers["X-EE-Operation"], "api-circuit-block-follow-ups");
    assert.equal(circuitFollowUps.body.data.state, "empty");

    assert.equal(whereUsed.statusCode, 200);
    assert.equal(whereUsed.headers["X-EE-Operation"], "api-part-where-used");
    assert.equal(whereUsed.body.data.usages[0]?.project.projectKey, "ALPHA");
    assert.equal(whereUsed.body.data.usages[0]?.usage.designators[0], "U1");

    assert.equal(globalWhereUsed.statusCode, 200);
    assert.equal(globalWhereUsed.headers["X-EE-Operation"], "api-where-used-search");
    assert.equal(globalWhereUsed.body.data.matchedCircuitBlocks[0]?.circuitBlock.blockKey, "ALPHA-POWER");
    assert.equal(globalWhereUsed.body.data.projectUsages[0]?.blockPart.role, "Main LDO");

    assert.equal(plannedWhereUsed.statusCode, 200);
    assert.equal(plannedWhereUsed.body.data.supportedTarget, true);
    assert.equal(plannedWhereUsed.body.data.state, "empty");
    assert.equal(plannedWhereUsed.body.data.unsupportedReason, null);

    assert.equal(lines.statusCode, 200);
    assert.equal(lines.body.data.lines.length, 2);
    assert.equal(lines.body.data.lines.find((line: any) => line.id === "line-alpha-2")?.matchStatus, "weak_match");

    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error.code, "PROJECT_NOT_FOUND");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
    restoreNodeEnv(previousNodeEnv);
  }
});

/**
 * Verifies project, BOM, and matching write routes power the site without creating fake usage.
 */
test("project memory write routes create projects, persist BOM imports, and run matching", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const pool = createProjectMemoryPool(false);
  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  setProjectMemoryStorePoolForTests(pool);
  const writtenStorage = new Map<string, Buffer>();
  setStorageClientForTests(createMemoryStorageClient(writtenStorage));

  try {
    const { handleRequest } = await import("./index");
    const preview = await invokeApiPost("/bom-imports/preview", {
      rawContent: "Refs,MPN,Maker,Qty\nU1,TPS7A02DBVR,Texas Instruments,1\n",
      sourceFilename: "beta.csv",
      sourceFormat: "csv"
    }, handleRequest);

    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers["X-EE-Operation"], "api-bom-import-preview");
    assert.equal(preview.body.data.rowCount, 1);

    const emptyAfterPreview = await readProjectsFromDatabase();
    assert.equal(emptyAfterPreview.status, "available");
    assert.equal(emptyAfterPreview.response.projects.length, 0);

    const project = await invokeApiPost("/projects", {
      initialRevisionLabel: "Rev A",
      name: "Beta Driver",
      projectKey: "BETA"
    }, handleRequest);

    assert.equal(project.statusCode, 201);
    assert.equal(project.body.data.project.id, "project-beta");

    const projectUpdate = await invokeApiPatch("/projects/project-beta", {
      description: "Edited beta notes.",
      name: "Beta Driver Edited",
      owner: "hardware",
      status: "production"
    }, handleRequest);
    const revisionUpdate = await invokeApiPatch("/projects/project-beta/revisions/rev-project-beta-rev-a", {
      releasedAt: "2026-05-02T10:00:00.000Z",
      revisionStatus: "released",
      sourceReference: "ECO-BETA"
    }, handleRequest);

    assert.equal(projectUpdate.statusCode, 200);
    assert.equal(projectUpdate.headers["X-EE-Operation"], "api-project-update");
    assert.equal(projectUpdate.body.data.project.status, "production");
    assert.match(projectUpdate.body.data.boundary, /do not approve parts/u);

    assert.equal(revisionUpdate.statusCode, 200);
    assert.equal(revisionUpdate.headers["X-EE-Operation"], "api-project-revision-update");
    assert.equal(revisionUpdate.body.data.revision.revisionStatus, "released");
    assert.match(revisionUpdate.body.data.boundary, /do not remap BOM rows/u);

    const bomImport = await invokeApiPost("/projects/project-beta/bom-imports", {
      columnMapping: {
        designators: "Refs",
        manufacturer: "Maker",
        mpn: "MPN",
        quantity: "Qty"
      },
      projectRevisionId: "rev-project-beta-rev-a",
      rawContent: "Refs,MPN,Maker,Qty\nU1,TPS7A02DBVR,Texas Instruments,1\n",
      sourceFilename: "beta.csv",
      sourceFormat: "csv"
    }, handleRequest);

    assert.equal(bomImport.statusCode, 201);
    assert.equal(bomImport.body.data.lineCount, 1);
    assert.equal(bomImport.body.data.linesPreview[0]?.matchStatus, "unmatched");

    const detail = await invokeApiGet("/projects/project-beta", handleRequest);
    assert.equal(detail.body.data.summary.bomImportCount, 1);
    assert.equal(detail.body.data.summary.usageCount, 0);

    const match = await invokeApiPost(`/bom-imports/${bomImport.body.data.bomImport.id}/match`, {}, handleRequest);

    assert.equal(match.statusCode, 200);
    assert.equal(match.headers["X-EE-Operation"], "api-bom-import-match");
    assert.equal(match.body.data.summary.matchedLineCount, 1);
    assert.equal(match.body.data.summary.usageCreatedOrUpdatedCount, 1);

    const detailAfterMatch = await invokeApiGet("/projects/project-beta", handleRequest);
    assert.equal(detailAfterMatch.body.data.summary.usageCount, 1);

    const evidence = await invokeApiPost("/evidence-attachments", {
      evidenceType: "link",
      sourceUrl: "https://example.test/beta-review",
      targetId: "project-beta",
      targetType: "project",
      title: "Beta review"
    }, handleRequest);

    assert.equal(evidence.statusCode, 201);
    assert.equal(evidence.headers["X-EE-Operation"], "api-evidence-attachment-create");
    assert.equal(evidence.body.data.attachment.targetType, "project");
    assert.match(evidence.body.data.boundary, /does not validate assets/u);

    const fileEvidence = await invokeApiPost("/evidence-attachments/files", {
      contentBase64: Buffer.from("project evidence bytes").toString("base64"),
      fileName: "beta-review.txt",
      mimeType: "text/plain",
      targetId: "project-beta",
      targetType: "project",
      title: "Beta review file"
    }, handleRequest);
    const evidenceVault = await invokeApiGet("/evidence-attachments?storageState=file_backed", handleRequest);

    assert.equal(fileEvidence.statusCode, 201);
    assert.equal(fileEvidence.headers["X-EE-Operation"], "api-evidence-file-upload");
    assert.equal(writtenStorage.size, 1);
    assert.equal(fileEvidence.body.data.attachment.evidenceType, "file");
    assert.match(fileEvidence.body.data.attachment.storageKey, /^evidence\/project\/project-beta\//u);
    assert.equal(evidenceVault.statusCode, 200);
    assert.equal(evidenceVault.body.data.summary.fileBackedCount, 1);

    const projectFollowUps = await invokeApiPost("/projects/project-beta/follow-ups", {}, handleRequest);
    const projectFollowUpUpdate = await invokeApiPatch(`/follow-ups/${projectFollowUps.body.data.followUps[0]?.id}`, {
      assignedTo: "hardware",
      evidenceAttachmentIds: [evidence.body.data.attachment.id],
      resolutionNotes: "Owned by hardware.",
      status: "in_progress"
    }, handleRequest);

    assert.equal(projectFollowUps.statusCode, 200);
    assert.equal(projectFollowUps.headers["X-EE-Operation"], "api-project-follow-ups-sync");
    assert.equal(projectFollowUps.body.data.createdCount > 0, true);
    assert.equal(projectFollowUpUpdate.statusCode, 200);
    assert.equal(projectFollowUpUpdate.headers["X-EE-Operation"], "api-follow-up-update");
    assert.equal(projectFollowUpUpdate.body.data.followUp.status, "in_progress");

    const circuitBlock = await invokeApiPost("/circuit-blocks", {
      blockKey: "BETA-POWER",
      blockType: "power",
      name: "Beta power rail",
      status: "draft"
    }, handleRequest);

    assert.equal(circuitBlock.statusCode, 201);
    assert.equal(circuitBlock.headers["X-EE-Operation"], "api-circuit-block-create");
    assert.equal(circuitBlock.body.data.circuitBlock.id, "cblock-beta-power");

    const circuitBlockUpdate = await invokeApiPatch("/circuit-blocks/cblock-beta-power", {
      blockType: "power",
      constraints: { note: "Edited power rail constraints." },
      description: "Edited block.",
      name: "Beta edited power rail",
      owner: "hardware",
      reuseScope: "Beta only",
      status: "restricted"
    }, handleRequest);

    assert.equal(circuitBlockUpdate.statusCode, 200);
    assert.equal(circuitBlockUpdate.headers["X-EE-Operation"], "api-circuit-block-update");
    assert.equal(circuitBlockUpdate.body.data.circuitBlock.status, "restricted");
    assert.match(circuitBlockUpdate.body.data.boundary, /linked parts keep their own approval/u);

    const circuitBlockPart = await invokeApiPost("/circuit-blocks/cblock-beta-power/parts", {
      partId: "part-memory-ldo",
      role: "Main regulator",
      quantity: 1
    }, handleRequest);

    assert.equal(circuitBlockPart.statusCode, 201);
    assert.equal(circuitBlockPart.headers["X-EE-Operation"], "api-circuit-block-part-create");
    assert.equal(circuitBlockPart.body.data.detail.summary.totalPartCount, 1);
    assert.match(circuitBlockPart.body.data.boundary, /does not approve the part/u);

    const circuitFollowUps = await invokeApiPost("/circuit-blocks/cblock-beta-power/follow-ups", {}, handleRequest);

    assert.equal(circuitFollowUps.statusCode, 200);
    assert.equal(circuitFollowUps.headers["X-EE-Operation"], "api-circuit-block-follow-ups-sync");
    assert.equal(circuitFollowUps.body.data.createdCount, 1);

    const circuitBlockPartUpdate = await invokeApiPatch(`/circuit-blocks/cblock-beta-power/parts/${circuitBlockPart.body.data.circuitBlockPart.id}`, {
      isRequired: false,
      notes: "Optional role for route coverage.",
      quantity: 2,
      substitutionPolicy: "do_not_substitute"
    }, handleRequest);

    assert.equal(circuitBlockPartUpdate.statusCode, 200);
    assert.equal(circuitBlockPartUpdate.headers["X-EE-Operation"], "api-circuit-block-part-update");
    assert.equal(circuitBlockPartUpdate.body.data.circuitBlockPart.isRequired, false);
    assert.equal(circuitBlockPartUpdate.body.data.detail.summary.requiredPartCount, 0);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    setStorageClientForTests(null);
    await pool.end();
    restoreTestAuth(previousTestAuth);
    restoreNodeEnv(previousNodeEnv);
  }
});

/**
 * Verifies project-memory routes do not fall back to seed or fake records without a database.
 */
test("project memory routes return DB_NOT_CONFIGURED honestly", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  setProjectMemoryStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/projects", handleRequest);

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, "DB_NOT_CONFIGURED");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    restoreDatabaseUrl(previousDatabaseUrl);
    restoreNodeEnv(previousNodeEnv);
  }
});

/**
 * Verifies revision compare requires two distinct revision ids that both exist on the project.
 */
test("readProjectRevisionCompareFromDatabase rejects identical or missing revisions", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const identical = await readProjectRevisionCompareFromDatabase("project-alpha", "rev-alpha-a", "rev-alpha-a");
    assert.equal(identical.status, "invalid");
    if (identical.status === "invalid") {
      assert.equal(identical.code, "IDENTICAL_REVISIONS");
    }

    const missing = await readProjectRevisionCompareFromDatabase("project-alpha", "rev-alpha-a", "rev-does-not-exist");
    assert.equal(missing.status, "not_found");
    if (missing.status === "not_found") {
      assert.equal(missing.code, "REVISIONS_NOT_FOUND");
    }

    const missingProject = await readProjectRevisionCompareFromDatabase("project-missing", "rev-alpha-a", "rev-other");
    assert.equal(missingProject.status, "not_found");
    if (missingProject.status === "not_found") {
      assert.equal(missingProject.code, "PROJECT_NOT_FOUND");
    }
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies revision compare diffs two revisions across BOM imports with explicit change groupings.
 */
test("readProjectRevisionCompareFromDatabase groups added/removed/quantity/designator/MPN-swap changes", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);
  await seedSecondRevisionForCompare(pool);

  try {
    const result = await readProjectRevisionCompareFromDatabase("project-alpha", "rev-alpha-a", "rev-alpha-b");

    assert.equal(result.status, "available");
    if (result.status !== "available") return;

    const response = result.response;
    assert.equal(response.fromRevisionId, "rev-alpha-a");
    assert.equal(response.toRevisionId, "rev-alpha-b");
    assert.deepEqual(response.fromBomImportIds, ["bom-alpha-a"]);
    assert.deepEqual(response.toBomImportIds, ["bom-alpha-b"]);

    const removedRow = response.rows.find((row) => row.changeKind === "removed");
    assert.ok(removedRow, "expected the unmatched weak resistor row to drop on the new revision");
    assert.equal(removedRow?.from?.rawMpn, "RC-UNKNOWN");

    const addedRow = response.rows.find((row) => row.changeKind === "added");
    assert.ok(addedRow, "expected the new resistor row to register as added");
    assert.equal(addedRow?.to?.rawMpn, "RC0603FR-0710KL");

    const swapRow = response.rows.find((row) => row.changeKind === "mpn_swap");
    assert.ok(swapRow, "expected the LDO entry to register as an MPN swap when the same matched part has a different raw MPN");
    assert.equal(swapRow?.matchedPartId, "part-memory-ldo");
    assert.match(swapRow?.changeDetail ?? "", /Raw MPN swapped:/u);

    assert.equal(response.addedCount, 1);
    assert.equal(response.removedCount, 1);
    assert.equal(response.mpnSwapCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies that quantity and designator-only changes get classified separately from MPN swaps.
 */
test("readProjectRevisionCompareFromDatabase distinguishes quantity and designator changes from MPN swaps", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);
  await seedThirdRevisionForCompare(pool);

  try {
    const result = await readProjectRevisionCompareFromDatabase("project-alpha", "rev-alpha-a", "rev-alpha-c");

    assert.equal(result.status, "available");
    if (result.status !== "available") return;

    const response = result.response;
    const quantityRow = response.rows.find((row) => row.changeKind === "quantity_changed");
    assert.ok(quantityRow, "expected the LDO row with the same MPN but different quantity to register as quantity_changed");
    assert.equal(quantityRow?.matchedPartId, "part-memory-ldo");
    assert.equal(quantityRow?.from?.quantity, 1);
    assert.equal(quantityRow?.to?.quantity, 3);
    assert.match(quantityRow?.changeDetail ?? "", /Quantity 1 -> 3/u);

    assert.equal(response.quantityChangedCount, 1);
    assert.equal(response.mpnSwapCount, 0);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies part substitution create persists a global approved record and forbids self-substitution.
 */
test("createPartSubstitutionInDatabase persists global approval and rejects self-substitution and missing parts", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const created = await createPartSubstitutionInDatabase(
      "part-memory-ldo",
      { scope: "global", signoffNotes: "Tested at 25C, accepted by hardware lead.", substitutePartId: "part-memory-resistor" },
      "test-admin"
    );
    assert.equal(created.status, "created");
    if (created.status === "created") {
      assert.equal(created.response.substitution.substitution.scope, "global");
      assert.equal(created.response.substitution.substitution.approvalStatus, "approved");
      assert.equal(created.response.substitution.substitutePartMpn, "RC0603FR-0710KL");
      assert.match(created.response.boundary, /do not change part approval/u);
    }

    const selfSub = await createPartSubstitutionInDatabase(
      "part-memory-ldo",
      { scope: "global", substitutePartId: "part-memory-ldo" },
      "test-admin"
    );
    assert.equal(selfSub.status, "invalid");
    if (selfSub.status === "invalid") assert.equal(selfSub.code, "SELF_SUBSTITUTION");

    const missingSub = await createPartSubstitutionInDatabase(
      "part-memory-ldo",
      { scope: "global", substitutePartId: "part-does-not-exist" },
      "test-admin"
    );
    assert.equal(missingSub.status, "not_found");
    if (missingSub.status === "not_found") assert.equal(missingSub.code, "SUBSTITUTE_PART_NOT_FOUND");

    const duplicate = await createPartSubstitutionInDatabase(
      "part-memory-ldo",
      { scope: "global", substitutePartId: "part-memory-resistor" },
      "test-admin"
    );
    assert.equal(duplicate.status, "conflict");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies substitution read returns active and revoked rows from both directions, and revoke preserves history.
 */
test("readPartSubstitutionsForPartFromDatabase lists both sides, and revoke moves a row to history", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const created = await createPartSubstitutionInDatabase(
      "part-memory-ldo",
      { scope: "project", projectId: "project-alpha", signoffNotes: "Project Alpha only.", substitutePartId: "part-memory-resistor" },
      "test-admin"
    );
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    const substitutionId = created.response.substitution.substitution.id;

    // Both sides see it
    const listOriginal = await readPartSubstitutionsForPartFromDatabase("part-memory-ldo");
    const listSubstitute = await readPartSubstitutionsForPartFromDatabase("part-memory-resistor");
    assert.equal(listOriginal.status, "available");
    assert.equal(listSubstitute.status, "available");
    if (listOriginal.status === "available") assert.equal(listOriginal.response.active.length, 1);
    if (listSubstitute.status === "available") assert.equal(listSubstitute.response.active.length, 1);

    // Revoke and re-read
    const revoked = await revokePartSubstitutionInDatabase(substitutionId, "test-admin");
    assert.equal(revoked.status, "revoked");

    const afterRevoke = await readPartSubstitutionsForPartFromDatabase("part-memory-ldo");
    assert.equal(afterRevoke.status, "available");
    if (afterRevoke.status === "available") {
      assert.equal(afterRevoke.response.active.length, 0);
      assert.equal(afterRevoke.response.revoked.length, 1);
      assert.equal(afterRevoke.response.revoked[0]?.substitution.revokedBy, "test-admin");
    }

    // Double-revoke is rejected
    const reRevoke = await revokePartSubstitutionInDatabase(substitutionId, "test-admin");
    assert.equal(reRevoke.status, "invalid");
    if (reRevoke.status === "invalid") assert.equal(reRevoke.code, "ALREADY_REVOKED");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies BOM diagnostics surface approved-substitute hints on weak/unmatched rows whose raw MPN matches a substitution side.
 */
test("readBomImportDiagnosticsFromDatabase surfaces approvedSubstituteHints for weak BOM rows", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    // Approve part-memory-resistor as a global substitute for part-memory-ldo. The seeded BOM has a weak_match
    // row with raw_mpn='RC-UNKNOWN' which won't match either side, so we also need to seed a row that DOES.
    // The seeded weak row 'RC-UNKNOWN' is already weak_match. Let's add a substitution where the raw MPN
    // 'RC-UNKNOWN' itself can't match — instead, seed a row with raw MPN matching the LDO.
    await pool.query(
      `INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at)
         VALUES ('line-alpha-3', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 3, '{"R2"}', 5, 'RC0603FR-0710KL', 'Yageo', 'Resistor (orphan)', '{"row":3}'::jsonb, NULL, 'weak_match', 0.5, '2026-04-30T00:11:00.000Z', '2026-04-30T00:11:00.000Z')`
    );

    // Approve LDO -> Resistor substitution (artificial; just enough to wire matching to raw MPN 'RC0603FR-0710KL')
    const created = await createPartSubstitutionInDatabase(
      "part-memory-ldo",
      { scope: "global", signoffNotes: "Validation fixture", substitutePartId: "part-memory-resistor" },
      "test-admin"
    );
    assert.equal(created.status, "created");

    const diagnostics = await readBomImportDiagnosticsFromDatabase("bom-alpha-a");
    assert.equal(diagnostics.status, "available");
    if (diagnostics.status !== "available") return;

    const orphanRow = diagnostics.response.rows.find((r) => r.lineId === "line-alpha-3");
    assert.ok(orphanRow, "expected the seeded orphan row to appear in diagnostics");
    assert.ok(
      (orphanRow!.approvedSubstituteHints.length ?? 0) >= 1,
      "expected an approved substitute hint to map RC0603FR-0710KL back to TPS7A02DBVR via the substitution"
    );
    assert.equal(orphanRow!.approvedSubstituteHints[0]?.candidatePartMpn, "TPS7A02DBVR");
    assert.ok(
      orphanRow!.triageActions.some((action) => /Approved substitute available/u.test(action)),
      "expected the substitute to be added to the triage actions list"
    );

    // The seeded row that's already 'matched' should NOT have substitute hints
    const matchedRow = diagnostics.response.rows.find((r) => r.lineId === "line-alpha-1");
    assert.ok(matchedRow);
    assert.equal(matchedRow!.approvedSubstituteHints.length, 0);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies fleet risk read returns not_configured without a database.
 */
test("readProjectFleetRiskFromDatabase reports not_configured without a project-memory database", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  setProjectMemoryStorePoolForTests(null);

  try {
    const result = await readProjectFleetRiskFromDatabase();
    assert.equal(result.status, "not_configured");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    restoreDatabaseUrl(previousDatabaseUrl);
  }
});

/**
 * Verifies fleet risk read returns an empty rows state when no projects are persisted.
 */
test("readProjectFleetRiskFromDatabase returns an empty fleet for a configured empty database", async () => {
  const pool = createProjectMemoryPool(false);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectFleetRiskFromDatabase();
    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    assert.equal(result.response.state, "empty");
    assert.deepEqual(result.response.rows, []);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies fleet risk row counts mirror persisted BOM rows, confirmed usage, lifecycle, CAD, and follow-up state.
 */
test("readProjectFleetRiskFromDatabase derives explainable per-project counts from fixture rows", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectFleetRiskFromDatabase();
    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    assert.equal(result.response.state, "available");
    assert.equal(result.response.rows.length, 1);

    const row = result.response.rows[0]!;
    assert.equal(row.project.id, "project-alpha");
    assert.equal(row.unmatchedLineCount, 0);
    assert.equal(row.weakOrAmbiguousLineCount, 1, "rev-alpha-a's RC-UNKNOWN row is weak_match");
    assert.equal(row.approvalGapCount, 0, "the LDO has approval_status='approved' in the catalog seed");
    assert.equal(row.lifecycleRiskCount, 0);
    assert.equal(row.missingVerifiedCadCount, 1, "the LDO has only a referenced symbol asset");
    assert.equal(row.openFollowUpCount, 0);
    assert.equal(row.totalRiskCount, row.weakOrAmbiguousLineCount + row.missingVerifiedCadCount);
    assert.match(result.response.boundary, /do not approve parts/u);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies circuit block instantiation rejects missing project, revision, and block ids without a partial write.
 */
test("instantiateCircuitBlockIntoProjectBomInDatabase rejects missing identifiers honestly", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const missingProject = await instantiateCircuitBlockIntoProjectBomInDatabase(
      "project-missing",
      { circuitBlockId: "cblock-alpha-power", projectRevisionId: "rev-alpha-a" },
      "test-admin"
    );
    assert.equal(missingProject.status, "not_found");
    if (missingProject.status === "not_found") assert.equal(missingProject.code, "PROJECT_NOT_FOUND");

    const missingRevision = await instantiateCircuitBlockIntoProjectBomInDatabase(
      "project-alpha",
      { circuitBlockId: "cblock-alpha-power", projectRevisionId: "rev-not-on-project" },
      "test-admin"
    );
    assert.equal(missingRevision.status, "not_found");
    if (missingRevision.status === "not_found") assert.equal(missingRevision.code, "PROJECT_REVISION_NOT_FOUND");

    const missingBlock = await instantiateCircuitBlockIntoProjectBomInDatabase(
      "project-alpha",
      { circuitBlockId: "cblock-not-found", projectRevisionId: "rev-alpha-a" },
      "test-admin"
    );
    assert.equal(missingBlock.status, "not_found");
    if (missingBlock.status === "not_found") assert.equal(missingBlock.code, "CIRCUIT_BLOCK_NOT_FOUND");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a happy-path circuit block instantiation creates a synthetic BOM import, matched lines, and confirmed usage.
 */
test("instantiateCircuitBlockIntoProjectBomInDatabase creates a synthetic BOM import with matched lines and usage", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await instantiateCircuitBlockIntoProjectBomInDatabase(
      "project-alpha",
      {
        circuitBlockId: "cblock-alpha-power",
        designatorPrefix: "U",
        includeOptional: false,
        notes: "First instantiation test",
        projectRevisionId: "rev-alpha-a"
      },
      "test-admin"
    );

    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    const response = result.response;
    assert.equal(response.bomImport.sourceFormat, "manual");
    assert.match(response.bomImport.sourceFilename, /Alpha power rail/u);
    assert.equal(response.matchedLineCount, 1);
    assert.equal(response.skippedOptionalCount, 0);
    assert.equal(response.bomLines.length, 1);

    const line = response.bomLines[0]!;
    assert.equal(line.matchedPartId, "part-memory-ldo");
    assert.equal(line.matchStatus, "matched");
    assert.equal(line.instantiatedFromCircuitBlockId, "cblock-alpha-power");
    assert.equal(line.instantiatedFromCircuitBlockPartId, "cbpart-alpha-power-ldo");
    assert.deepEqual(line.designators, ["U1"]);

    assert.equal(response.instantiation.circuitBlockId, "cblock-alpha-power");
    assert.equal(response.instantiation.bomImportId, response.bomImport.id);
    assert.equal(response.instantiation.designatorPrefix, "U");
    assert.equal(response.instantiation.includeOptional, false);
    assert.equal(response.instantiation.notes, "First instantiation test");
    assert.match(response.boundary, /do not change part approval/u);

    const usageRows = await pool.query<{ part_id: string; bom_line_id: string }>(
      "SELECT part_id, bom_line_id FROM project_part_usages WHERE project_id = $1",
      ["project-alpha"]
    );
    assert.ok(
      usageRows.rows.some((row) => row.part_id === "part-memory-ldo" && row.bom_line_id === line.id),
      "expected a confirmed usage row pointing at the instantiated BOM line"
    );
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the connector-set catalog returns groups, mate pairs, and project usage counts without inventing schema.
 */
test("readConnectorSetCatalogFromDatabase returns connector groups with mate pairs and trust boundary copy", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    await seedConnectorCatalogRowsViaPool(pool);

    const result = await readConnectorSetCatalogFromDatabase();
    assert.equal(result.status, "available");
    if (result.status !== "available") return;

    const response = result.response;
    assert.equal(response.state, "available");
    assert.match(response.boundary, /does not approve/i);
    assert.equal(response.connectorClassFilter, null);
    assert.equal(response.totalConnectorCount, 4);
    assert.equal(response.totalMatePairCount, 2);

    const connectorGroup = response.groups.find((group) => group.connectorClass === "connector");
    assert.ok(connectorGroup, "expected a 'connector' group");
    const housing = connectorGroup!.entries.find((entry) => entry.partId === "part-conn-housing");
    assert.ok(housing, "expected the housing part in the connector group");
    assert.equal(housing!.matePairs.length, 2);
    const bestMate = housing!.matePairs.find((pair) => pair.relationshipType === "best_mate");
    const altMate = housing!.matePairs.find((pair) => pair.relationshipType === "alternate_mate");
    assert.ok(bestMate);
    assert.equal(bestMate!.matePartId, "part-conn-mate");
    assert.equal(bestMate!.confidenceScore, 0.95);
    assert.ok(altMate);
    assert.equal(altMate!.matePartId, "part-conn-alt");

    const toolingGroup = response.groups.find((group) => group.connectorClass === "tooling");
    assert.ok(toolingGroup, "expected a 'tooling' group for the crimp tool");
    assert.equal(toolingGroup!.entries.length, 1);

    const filtered = await readConnectorSetCatalogFromDatabase({ connectorClass: "connector" });
    if (filtered.status !== "available") throw new Error("filtered call should succeed");
    assert.equal(filtered.response.totalConnectorCount, 3);
    assert.equal(filtered.response.connectorClassFilter, "connector");

    const queryResult = await readConnectorSetCatalogFromDatabase({ query: "BM02B" });
    if (queryResult.status !== "available") throw new Error("query call should succeed");
    assert.equal(queryResult.response.totalConnectorCount, 1);
    assert.equal(queryResult.response.query, "BM02B");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the approval-batch candidates query returns matched-usage parts whose approval is missing
 * and excludes parts that are already approved.
 */
test("readApprovalBatchCandidatesFromDatabase returns matched parts with approval gaps for one project", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    // Add a second matched line to project-alpha that points at a different (un-approved) part.
    await pool.query(`INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at) VALUES ('line-alpha-3', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 3, '{"R2"}', 1, 'RC0603FR-0710KL', 'Yageo', '10K resistor', '{"row":3}'::jsonb, 'part-memory-resistor', 'matched', 1, '2026-04-30T00:05:30.000Z', '2026-04-30T00:05:30.000Z')`);

    const result = await readApprovalBatchCandidatesFromDatabase("project-alpha");
    assert.equal(result.status, "available");
    if (result.status !== "available") return;

    const response = result.response;
    assert.equal(response.projectId, "project-alpha");
    assert.equal(response.state, "available");
    assert.match(response.boundary, /Approval state does not validate/i);

    // The LDO row is matched but already approved, so it must be excluded.
    assert.ok(
      response.candidates.every((candidate) => candidate.partId !== "part-memory-ldo"),
      "approved part should be excluded from the candidate queue"
    );

    // The resistor row is matched and not approved, so it should be present.
    const resistor = response.candidates.find((candidate) => candidate.partId === "part-memory-resistor");
    assert.ok(resistor, "expected the resistor as a candidate row");
    assert.equal(resistor!.mpn, "RC0603FR-0710KL");
    assert.equal(resistor!.bomLineCount, 1);
    assert.deepEqual(resistor!.designators, ["R2"]);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a bulk approve action persists approved status only and records project-context evidence,
 * without changing readiness, lifecycle, or assets.
 */
test("applyApprovalBatchInDatabase applies bulk approve and records project context without altering readiness or assets", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await applyApprovalBatchInDatabase(
      "project-alpha",
      { action: "approve", notes: "OK for ALPHA design", partIds: ["part-memory-resistor", "part-memory-ldo", "part-missing"] },
      "test-admin"
    );

    assert.equal(result.status, "applied");
    if (result.status !== "applied") return;

    const response = result.response;
    assert.equal(response.action, "approve");
    assert.equal(response.appliedCount, 1);
    assert.equal(response.skippedCount, 1);
    assert.equal(response.notFoundCount, 1);
    assert.match(response.boundary, /Bulk approval records project context/i);

    const resistorOutcome = response.outcomes.find((outcome) => outcome.partId === "part-memory-resistor");
    assert.ok(resistorOutcome);
    assert.equal(resistorOutcome!.status, "applied");
    assert.equal(resistorOutcome!.newApprovalStatus, "approved");

    const ldoOutcome = response.outcomes.find((outcome) => outcome.partId === "part-memory-ldo");
    assert.ok(ldoOutcome);
    assert.equal(ldoOutcome!.status, "skipped_already_approved");

    const missingOutcome = response.outcomes.find((outcome) => outcome.partId === "part-missing");
    assert.ok(missingOutcome);
    assert.equal(missingOutcome!.status, "not_found");

    const approvalRow = await pool.query<{ approval_status: string; summary: string; evidence: unknown }>(
      "SELECT approval_status, summary, evidence FROM part_approvals WHERE part_id = $1",
      ["part-memory-resistor"]
    );
    assert.equal(approvalRow.rows[0]?.approval_status, "approved");
    assert.match(String(approvalRow.rows[0]?.summary), /ALPHA/u);

    // Readiness rows should be untouched.
    const readinessRow = await pool.query<{ readiness_status: string }>(
      "SELECT readiness_status FROM part_readiness_summaries WHERE part_id = $1",
      ["part-memory-ldo"]
    );
    assert.equal(readinessRow.rows[0]?.readiness_status, "needs_attention");

    // Assets should be untouched.
    const assetCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM assets WHERE part_id = $1 AND export_status = 'verified_for_export'",
      ["part-memory-ldo"]
    );
    assert.equal(assetCount.rows[0]?.count, "0");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies validation rejects invalid input before any database work runs.
 */
test("applyApprovalBatchInDatabase rejects empty partIds and unsupported actions", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const empty = await applyApprovalBatchInDatabase("project-alpha", { action: "approve", partIds: [] }, "test-admin");
    assert.equal(empty.status, "invalid");
    if (empty.status === "invalid") {
      assert.equal(empty.code, "PART_IDS_REQUIRED");
    }

    const badAction = await applyApprovalBatchInDatabase("project-alpha", { action: "weird_action" as any, partIds: ["part-memory-resistor"] }, "test-admin");
    assert.equal(badAction.status, "invalid");
    if (badAction.status === "invalid") {
      assert.equal(badAction.code, "INVALID_ACTION");
    }

    const missingProject = await applyApprovalBatchInDatabase("project-not-here", { action: "approve", partIds: ["part-memory-resistor"] }, "test-admin");
    assert.equal(missingProject.status, "not_found");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies bundle file availability stays honest across the three states the UI cares about.
 *
 * - `null` storage_key always reports `manifest_only`, regardless of storage backend.
 * - Storage clients that confirm the file is present yield `available`.
 * - Storage clients that report the file is gone yield `file_missing`, so the UI can
 *   warn the engineer instead of advertising a broken Download link.
 */
test("resolveExportBundleFileAvailability distinguishes manifest-only, available, and file-missing", async () => {
  const presentClient: FileStorageClient = {
    backend: "local",
    async exists() { return true; },
    async getDownloadUrl() { return "http://storage.test/present"; },
    async read() { return Buffer.from(""); },
    async write() { /* not used */ }
  };

  const missingClient: FileStorageClient = {
    backend: "local",
    async exists() { return false; },
    async getDownloadUrl() { return "http://storage.test/missing"; },
    async read() { return Buffer.from(""); },
    async write() { /* not used */ }
  };

  const throwingClient: FileStorageClient = {
    backend: "local",
    async exists() { throw new Error("storage unreachable"); },
    async getDownloadUrl() { return null; },
    async read() { return Buffer.from(""); },
    async write() { /* not used */ }
  };

  assert.equal(await resolveExportBundleFileAvailability(null, presentClient), "manifest_only");
  assert.equal(await resolveExportBundleFileAvailability("bundles/x.zip", undefined), "manifest_only");
  assert.equal(await resolveExportBundleFileAvailability("bundles/x.zip", presentClient), "available");
  assert.equal(await resolveExportBundleFileAvailability("bundles/x.zip", missingClient), "file_missing");
  assert.equal(await resolveExportBundleFileAvailability("bundles/x.zip", throwingClient), "file_missing");
});

test("createExportBundleInDatabase writes archive content when storage is available", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);
  const writes: Array<{ key: string; content: string }> = [];
  const storage: FileStorageClient = {
    backend: "local",
    async exists() { return true; },
    async getDownloadUrl() { return "http://storage.local/example"; },
    async read() { return Buffer.from(""); },
    async write(storageKey, content) {
      writes.push({ content: content.toString("utf8"), key: storageKey });
    }
  };

  try {
    await pool.query(`
      CREATE TABLE export_bundles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        revision_label TEXT,
        bundle_format TEXT NOT NULL,
        storage_key TEXT,
        archive_storage_key TEXT,
        manifest JSONB NOT NULL,
        part_count INTEGER NOT NULL DEFAULT 0,
        included_asset_count INTEGER NOT NULL DEFAULT 0,
        omitted_asset_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        assembly_status TEXT NOT NULL DEFAULT 'not_required',
        assembly_error JSONB,
        assembly_completed_at TIMESTAMPTZ,
        assembly_attempt_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query("ALTER TABLE assets ADD COLUMN file_format TEXT NOT NULL DEFAULT 'step'");
    await pool.query("ALTER TABLE assets ADD COLUMN provenance TEXT NOT NULL DEFAULT 'generated'");
    const result = await createExportBundleInDatabase("project-alpha", { bundleFormat: "neutral" }, "test-admin", storage);
    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    const { bundle } = result.response;
    assert.equal(bundle.fileAvailability, "available");
    assert.ok(bundle.storageKey);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.key, bundle.storageKey);
    assert.match(writes[0]?.content ?? "", /"bundleId":/u);
    assert.match(writes[0]?.content ?? "", /"includedAssets":/u);
    assert.equal(bundle.manifest.warnings.some((warning) => /archive write failed/i.test(warning)), false);
    // Asset-byte assembly is queued asynchronously when the bundle has zero or more included assets;
    // because the test fixture has no verified-for-export assets seeded, the bundle resolves to
    // not_required immediately and never blocks the API response on storage I/O.
    const expectedAssemblyStatus = bundle.includedAssetCount === 0 ? "not_required" : "pending";
    assert.equal(bundle.assemblyStatus, expectedAssemblyStatus);
    assert.equal(bundle.assemblyError, null);
    assert.equal(bundle.assemblyAttemptCount, 0);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

test("createExportBundleInDatabase surfaces archive write failures as bundle warnings", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);
  const storage: FileStorageClient = {
    backend: "local",
    async exists() { return false; },
    async getDownloadUrl() { return null; },
    async read() { return Buffer.from(""); },
    async write() { throw new Error("disk full"); }
  };

  try {
    await pool.query(`
      CREATE TABLE export_bundles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        revision_label TEXT,
        bundle_format TEXT NOT NULL,
        storage_key TEXT,
        archive_storage_key TEXT,
        manifest JSONB NOT NULL,
        part_count INTEGER NOT NULL DEFAULT 0,
        included_asset_count INTEGER NOT NULL DEFAULT 0,
        omitted_asset_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        assembly_status TEXT NOT NULL DEFAULT 'not_required',
        assembly_error JSONB,
        assembly_completed_at TIMESTAMPTZ,
        assembly_attempt_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query("ALTER TABLE assets ADD COLUMN file_format TEXT NOT NULL DEFAULT 'step'");
    await pool.query("ALTER TABLE assets ADD COLUMN provenance TEXT NOT NULL DEFAULT 'generated'");
    const result = await createExportBundleInDatabase("project-alpha", { bundleFormat: "neutral" }, "test-admin", storage);
    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    const { bundle } = result.response;
    assert.equal(bundle.fileAvailability, "manifest_only");
    assert.equal(bundle.storageKey, null);
    assert.equal(bundle.manifest.warnings.some((warning) => /archive write failed \(disk full\)/i.test(warning)), true);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Creates a pg-mem project-memory database with optional fixture rows.
 */
function createProjectMemoryPool(seedRows: boolean): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE manufacturers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      mpn TEXT NOT NULL,
      manufacturer_id TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL DEFAULT 'active',
      connector_family_id TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      storage_key TEXT,
      file_hash TEXT,
      source_url TEXT,
      export_status TEXT NOT NULL DEFAULT 'not_exportable',
      validation_status TEXT NOT NULL DEFAULT 'not_validated',
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE part_approvals (
      part_id TEXT PRIMARY KEY,
      approval_status TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      evidence TEXT[] NOT NULL DEFAULT '{}',
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE part_readiness_summaries (
      part_id TEXT PRIMARY KEY,
      readiness_status TEXT NOT NULL,
      identity_status TEXT NOT NULL,
      connector_class TEXT NOT NULL,
      blocker_count INTEGER NOT NULL DEFAULT 0,
      blocker_summary TEXT[] NOT NULL DEFAULT '{}',
      recommended_actions TEXT[] NOT NULL DEFAULT '{}',
      detail TEXT NOT NULL,
      last_evaluated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE project_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_label TEXT NOT NULL,
      revision_status TEXT NOT NULL DEFAULT 'draft',
      source_reference TEXT,
      released_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE bom_imports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT 'csv',
      storage_key TEXT,
      import_status TEXT NOT NULL DEFAULT 'uploaded',
      column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
      import_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE bom_lines (
      id TEXT PRIMARY KEY,
      bom_import_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      designators TEXT[] NOT NULL DEFAULT '{}',
      quantity NUMERIC,
      raw_mpn TEXT,
      raw_manufacturer TEXT,
      raw_description TEXT,
      raw_supplier_reference TEXT,
      raw_notes TEXT,
      raw_row_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      matched_part_id TEXT,
      match_status TEXT NOT NULL DEFAULT 'unmatched',
      match_confidence_score NUMERIC,
      instantiated_from_circuit_block_id TEXT,
      instantiated_from_circuit_block_part_id TEXT,
      instantiated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE circuit_block_instantiations (
      id TEXT PRIMARY KEY,
      circuit_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      bom_import_id TEXT NOT NULL,
      include_optional BOOLEAN NOT NULL DEFAULT false,
      designator_prefix TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE part_substitutions (
      id TEXT PRIMARY KEY,
      original_part_id TEXT NOT NULL,
      substitute_part_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      signoff_notes TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'approved',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      revoked_by TEXT
    );

    CREATE TABLE project_part_usages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      bom_line_id TEXT,
      part_id TEXT NOT NULL,
      usage_context TEXT,
      designators TEXT[] NOT NULL DEFAULT '{}',
      quantity NUMERIC,
      usage_status TEXT NOT NULL DEFAULT 'proposed',
      approval_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      readiness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE evidence_attachments (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      title TEXT NOT NULL,
      source_url TEXT,
      storage_key TEXT,
      file_hash TEXT,
      mime_type TEXT,
      notes TEXT,
      provenance TEXT NOT NULL DEFAULT 'manual_internal',
      review_status TEXT NOT NULL DEFAULT 'unreviewed',
      uploaded_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE follow_up_records (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_finding_id TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      next_action TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      source_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
      evidence_attachment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      resolution_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      UNIQUE (target_type, target_id, source_type, source_finding_id)
    );

    CREATE TABLE circuit_blocks (
      id TEXT PRIMARY KEY,
      block_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      block_type TEXT NOT NULL DEFAULT 'other',
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      reuse_scope TEXT NOT NULL DEFAULT '',
      constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE circuit_block_parts (
      id TEXT PRIMARY KEY,
      circuit_block_id TEXT NOT NULL,
      part_id TEXT NOT NULL,
      role TEXT NOT NULL,
      quantity NUMERIC,
      is_required BOOLEAN NOT NULL DEFAULT true,
      substitution_policy TEXT NOT NULL DEFAULT 'exact_required',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (circuit_block_id, part_id, role)
    );

    CREATE TABLE mate_relations (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      mate_part_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      confidence_score NUMERIC NOT NULL DEFAULT 1,
      source_revision_id TEXT,
      notes TEXT
    );
  `);

  seedInternalCatalogRows(db);

  if (seedRows) {
    seedProjectMemoryRows(db);
  }

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Seeds internal catalog identity rows used by deterministic BOM matching tests.
 */
function seedInternalCatalogRows(db: ReturnType<typeof newDb>): void {
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases)
    VALUES
      ('mfg-ti', 'Texas Instruments', '{"TI"}'),
      ('mfg-yageo', 'Yageo', '{}'),
      ('mfg-alpha', 'Alpha Semi', '{}'),
      ('mfg-beta', 'Beta Semi', '{}');

    INSERT INTO parts (id, mpn, manufacturer_id, last_updated_at)
    VALUES
      ('part-memory-ldo', 'TPS7A02DBVR', 'mfg-ti', '2026-04-30T00:06:00.000Z'),
      ('part-memory-resistor', 'RC0603FR-0710KL', 'mfg-yageo', '2026-04-30T00:06:00.000Z'),
      ('part-dup-alpha', 'DUP-123', 'mfg-alpha', '2026-04-30T00:06:00.000Z'),
      ('part-dup-beta', 'DUP-123', 'mfg-beta', '2026-04-30T00:06:00.000Z');

    INSERT INTO assets (id, part_id, asset_type, storage_key, file_hash, source_url, export_status, validation_status, last_updated_at)
    VALUES ('asset-memory-ldo-symbol-ref', 'part-memory-ldo', 'symbol', NULL, NULL, 'https://example.test/tps7a02-symbol', 'not_exportable', 'not_validated', '2026-04-30T00:06:30.000Z');

    INSERT INTO part_approvals (part_id, approval_status, summary, detail, evidence, decided_by, decided_at, last_updated_at)
    VALUES ('part-memory-ldo', 'approved', 'Approved', 'Approved for fixture testing.', '{"fixture"}', 'qa', '2026-04-30T00:07:00.000Z', '2026-04-30T00:07:00.000Z');

    INSERT INTO part_readiness_summaries (part_id, readiness_status, identity_status, connector_class, blocker_count, blocker_summary, recommended_actions, detail, last_evaluated_at)
    VALUES ('part-memory-ldo', 'needs_attention', 'confirmed', 'non_connector', 1, '{"missing verified CAD"}', '{"review CAD"}', 'Fixture readiness summary.', '2026-04-30T00:08:00.000Z');
  `);
}

/**
 * Seeds connector parts and mate_relations rows for connector-set catalog tests.
 */
async function seedConnectorCatalogRowsViaPool(pool: TestPool): Promise<void> {
  await pool.query(`INSERT INTO manufacturers (id, name, aliases) VALUES ('mfg-jst', 'JST', '{}')`);
  await pool.query(`INSERT INTO parts (id, mpn, manufacturer_id, last_updated_at) VALUES ('part-conn-housing', 'BM02B-SRSS-TB', 'mfg-jst', '2026-04-30T00:06:00.000Z')`);
  await pool.query(`INSERT INTO parts (id, mpn, manufacturer_id, last_updated_at) VALUES ('part-conn-mate', 'SHR-02V-S-B', 'mfg-jst', '2026-04-30T00:06:00.000Z')`);
  await pool.query(`INSERT INTO parts (id, mpn, manufacturer_id, last_updated_at) VALUES ('part-conn-alt', 'SHR-02V-S-S', 'mfg-jst', '2026-04-30T00:06:00.000Z')`);
  await pool.query(`INSERT INTO parts (id, mpn, manufacturer_id, last_updated_at) VALUES ('part-conn-tool', 'WC-110', 'mfg-jst', '2026-04-30T00:06:00.000Z')`);
  await pool.query(`INSERT INTO part_readiness_summaries (part_id, readiness_status, identity_status, connector_class, blocker_count, blocker_summary, recommended_actions, detail, last_evaluated_at) VALUES ('part-conn-housing', 'ready_for_export_review', 'confirmed', 'connector', 0, '{}', '{}', 'Connector housing.', '2026-04-30T00:08:00.000Z')`);
  await pool.query(`INSERT INTO part_readiness_summaries (part_id, readiness_status, identity_status, connector_class, blocker_count, blocker_summary, recommended_actions, detail, last_evaluated_at) VALUES ('part-conn-mate', 'ready_for_export_review', 'confirmed', 'connector', 0, '{}', '{}', 'Mate housing.', '2026-04-30T00:08:00.000Z')`);
  await pool.query(`INSERT INTO part_readiness_summaries (part_id, readiness_status, identity_status, connector_class, blocker_count, blocker_summary, recommended_actions, detail, last_evaluated_at) VALUES ('part-conn-alt', 'needs_attention', 'confirmed', 'connector', 1, '{"missing CAD"}', '{}', 'Alt mate.', '2026-04-30T00:08:00.000Z')`);
  await pool.query(`INSERT INTO part_readiness_summaries (part_id, readiness_status, identity_status, connector_class, blocker_count, blocker_summary, recommended_actions, detail, last_evaluated_at) VALUES ('part-conn-tool', 'ready_for_export_review', 'confirmed', 'tooling', 0, '{}', '{}', 'Crimp tool.', '2026-04-30T00:08:00.000Z')`);
  await pool.query(`INSERT INTO part_approvals (part_id, approval_status, summary, detail, evidence, decided_by, decided_at, last_updated_at) VALUES ('part-conn-housing', 'approved', 'Approved', 'Approved housing.', '{}', 'qa', '2026-04-30T00:07:00.000Z', '2026-04-30T00:07:00.000Z')`);
  await pool.query(`INSERT INTO mate_relations (id, part_id, mate_part_id, relationship_type, confidence_score, source_revision_id, notes) VALUES ('mr-housing-best', 'part-conn-housing', 'part-conn-mate', 'best_mate', 0.95, NULL, 'Manufacturer table')`);
  await pool.query(`INSERT INTO mate_relations (id, part_id, mate_part_id, relationship_type, confidence_score, source_revision_id, notes) VALUES ('mr-housing-alt', 'part-conn-housing', 'part-conn-alt', 'alternate_mate', 0.7, NULL, 'Likely alternate')`);
}

/**
 * Seeds one project with two BOM lines but only one confirmed usage record.
 */
function seedProjectMemoryRows(db: ReturnType<typeof newDb>): void {
  db.public.none(`
    INSERT INTO projects (id, project_key, name, description, owner, status, created_at, updated_at)
    VALUES ('project-alpha', 'ALPHA', 'Alpha Controller', 'Memory API test project', 'hardware', 'active', '2026-04-30T00:00:00.000Z', '2026-04-30T00:01:00.000Z');

    INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at)
    VALUES ('rev-alpha-a', 'project-alpha', 'A', 'draft', 'alpha-a', '2026-04-30T00:02:00.000Z', '2026-04-30T00:02:00.000Z');

    INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, import_status, column_mapping, import_summary, imported_by, created_at, updated_at)
    VALUES ('bom-alpha-a', 'project-alpha', 'rev-alpha-a', 'alpha-bom.csv', 'csv', 'mapped', '{"mpn":"MPN","quantity":"Qty"}'::jsonb, '{"rowCount":2}'::jsonb, 'api-test', '2026-04-30T00:03:00.000Z', '2026-04-30T00:03:00.000Z');

    INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at)
    VALUES
      ('line-alpha-1', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 1, '{"U1"}', 1, 'TPS7A02DBVR', 'Texas Instruments', 'LDO regulator', '{"row":1}'::jsonb, 'part-memory-ldo', 'matched', 1, '2026-04-30T00:04:00.000Z', '2026-04-30T00:04:00.000Z'),
      ('line-alpha-2', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 2, '{"R1"}', 1, 'RC-UNKNOWN', 'Unknown', 'Weak resistor row', '{"row":2}'::jsonb, NULL, 'weak_match', 0.4, '2026-04-30T00:05:00.000Z', '2026-04-30T00:05:00.000Z');

    INSERT INTO project_part_usages (id, project_id, project_revision_id, bom_line_id, part_id, usage_context, designators, quantity, usage_status, approval_snapshot, readiness_snapshot, created_at, updated_at)
    VALUES ('usage-alpha-u1', 'project-alpha', 'rev-alpha-a', 'line-alpha-1', 'part-memory-ldo', 'Main rail regulator', '{"U1"}', 1, 'proposed', '{"approvalStatus":"not_requested"}'::jsonb, '{"readinessStatus":"blocked"}'::jsonb, '2026-04-30T00:06:00.000Z', '2026-04-30T00:06:00.000Z');

    INSERT INTO circuit_blocks (id, block_key, name, description, block_type, owner, status, reuse_scope, constraints, created_at, updated_at)
    VALUES ('cblock-alpha-power', 'ALPHA-POWER', 'Alpha power rail', 'Reusable LDO rail for memory tests.', 'power', 'hardware', 'approved', 'Fixture power rails only', '{"note":"Keep near load"}'::jsonb, '2026-04-30T00:09:00.000Z', '2026-04-30T00:09:00.000Z');

    INSERT INTO circuit_block_parts (id, circuit_block_id, part_id, role, quantity, is_required, substitution_policy, notes, created_at, updated_at)
    VALUES ('cbpart-alpha-power-ldo', 'cblock-alpha-power', 'part-memory-ldo', 'Main LDO', 1, true, 'exact_required', 'Use with reviewed output capacitor.', '2026-04-30T00:10:00.000Z', '2026-04-30T00:10:00.000Z');
  `);
}

/**
 * Adds a second revision to project-alpha that triggers add/remove and an MPN swap against rev-alpha-a.
 */
async function seedSecondRevisionForCompare(pool: TestPool): Promise<void> {
  await pool.query(`INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at) VALUES ('rev-alpha-b', 'project-alpha', 'B', 'draft', 'alpha-b', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`);
  await pool.query(`INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, import_status, column_mapping, import_summary, imported_by, created_at, updated_at) VALUES ('bom-alpha-b', 'project-alpha', 'rev-alpha-b', 'alpha-bom-b.csv', 'csv', 'mapped', '{"mpn":"MPN","quantity":"Qty"}'::jsonb, '{"rowCount":2}'::jsonb, 'api-test', '2026-05-01T00:01:00.000Z', '2026-05-01T00:01:00.000Z')`);
  await pool.query(`INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at) VALUES ('line-beta-1', 'bom-alpha-b', 'project-alpha', 'rev-alpha-b', 1, '{"U1"}', 1, 'TPS7A02DBVR-Q1', 'Texas Instruments', 'LDO regulator (auto)', '{"row":1}'::jsonb, 'part-memory-ldo', 'matched', 1, '2026-05-01T00:02:00.000Z', '2026-05-01T00:02:00.000Z')`);
  await pool.query(`INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at) VALUES ('line-beta-2', 'bom-alpha-b', 'project-alpha', 'rev-alpha-b', 2, '{"R1"}', 10, 'RC0603FR-0710KL', 'Yageo', 'New 10K resistor', '{"row":2}'::jsonb, 'part-memory-resistor', 'matched', 1, '2026-05-01T00:03:00.000Z', '2026-05-01T00:03:00.000Z')`);
}

/**
 * Adds a third revision to project-alpha that triggers a quantity-only change against rev-alpha-a.
 */
async function seedThirdRevisionForCompare(pool: TestPool): Promise<void> {
  await pool.query(`INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at) VALUES ('rev-alpha-c', 'project-alpha', 'C', 'draft', 'alpha-c', '2026-05-02T00:00:00.000Z', '2026-05-02T00:00:00.000Z')`);
  await pool.query(`INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, import_status, column_mapping, import_summary, imported_by, created_at, updated_at) VALUES ('bom-alpha-c', 'project-alpha', 'rev-alpha-c', 'alpha-bom-c.csv', 'csv', 'mapped', '{"mpn":"MPN","quantity":"Qty"}'::jsonb, '{"rowCount":2}'::jsonb, 'api-test', '2026-05-02T00:01:00.000Z', '2026-05-02T00:01:00.000Z')`);
  await pool.query(`INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at) VALUES ('line-gamma-1', 'bom-alpha-c', 'project-alpha', 'rev-alpha-c', 1, '{"U1"}', 3, 'TPS7A02DBVR', 'Texas Instruments', 'LDO regulator', '{"row":1}'::jsonb, 'part-memory-ldo', 'matched', 1, '2026-05-02T00:02:00.000Z', '2026-05-02T00:02:00.000Z')`);
  await pool.query(`INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at) VALUES ('line-gamma-2', 'bom-alpha-c', 'project-alpha', 'rev-alpha-c', 2, '{"R1"}', 1, 'RC-UNKNOWN', 'Unknown', 'Weak resistor row', '{"row":2}'::jsonb, NULL, 'weak_match', 0.4, '2026-05-02T00:03:00.000Z', '2026-05-02T00:03:00.000Z')`);
}

/**
 * Creates an in-memory storage test double for evidence file upload routes.
 */
function createMemoryStorageClient(writtenStorage: Map<string, Buffer>): FileStorageClient {
  return {
    backend: "local",
    async exists(storageKey: string): Promise<boolean> {
      return writtenStorage.has(storageKey);
    },
    async getDownloadUrl(storageKey: string): Promise<string | null> {
      return `http://storage.test/${encodeURIComponent(storageKey)}`;
    },
    async read(storageKey: string): Promise<Buffer> {
      const content = writtenStorage.get(storageKey);

      if (!content) {
        throw new Error(`storage key not found: ${storageKey}`);
      }

      return content;
    },
    async write(storageKey: string, content: Buffer): Promise<void> {
      writtenStorage.set(storageKey, content);
    }
  };
}

/**
 * Invokes the API handler with a tiny in-memory GET request/response pair.
 */
async function invokeApiGet(
  url: string,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const request = Readable.from([]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { host: "localhost" };
  request.method = "GET";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Invokes the API handler with a tiny in-memory POST request/response pair.
 */
async function invokeApiPost(
  url: string,
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const requestBody = JSON.stringify(body);
  const request = Readable.from([requestBody]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = {
    "content-type": "application/json",
    host: "localhost"
  };
  request.method = "POST";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Invokes the API handler with a tiny in-memory PATCH request/response pair.
 */
async function invokeApiPatch(
  url: string,
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const requestBody = JSON.stringify(body);
  const request = Readable.from([requestBody]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = {
    "content-type": "application/json",
    host: "localhost"
  };
  request.method = "PATCH";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Restores NODE_ENV after route tests mutate it.
 */
function restoreNodeEnv(previousNodeEnv: string | undefined): void {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

/**
 * Restores the explicit test auth opt-in after write route tests.
 */
function restoreTestAuth(previousTestAuth: string | undefined): void {
  if (previousTestAuth === undefined) {
    delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  } else {
    process.env.EE_LIBRARY_ALLOW_TEST_AUTH = previousTestAuth;
  }
}

/**
 * Restores DATABASE_URL after not-configured tests mutate it.
 */
function restoreDatabaseUrl(previousDatabaseUrl: string | undefined): void {
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
