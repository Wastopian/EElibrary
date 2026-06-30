/**
 * File header: Tests controlled document revision, ACL, supersession, and redline persistence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  createDocumentRedlineInDatabase,
  createDocumentRevisionInDatabase,
  readAssetDownloadAclGrant,
  readAssetDownloadGateFromDatabase,
  readDocumentRevisionsForPartFromDatabase,
  setDocumentControlPoolForTests,
  updateDocumentRedlineInDatabase
} from "./document-control";
import { enterRequestContextForTests } from "./request-context";
import type { Pool } from "pg";

type TestPool = Pool & {
  end: () => Promise<void>;
};

/**
 * Verifies controlled revisions can supersede a prior released revision and preserve ACL intent.
 */
test("document control creates revisions with ACLs and supersession", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    const first = await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "restricted",
      aclEntries: [
        {
          permission: "review",
          principalId: "hardware-team",
          principalType: "team"
        }
      ],
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "released",
      revisionDate: "2026-05-01",
      revisionLabel: "Rev A"
    }, "admin-user");

    assert.equal(first.status, "created");
    if (first.status !== "created") return;
    assert.equal(first.response.revision.revisionLabel, "Rev A");
    assert.equal(first.response.revision.aclEntries[0]?.principalId, "hardware-team");

    const second = await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "internal",
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "released",
      revisionDate: "2026-05-10",
      revisionLabel: "Rev B",
      supersedesDocumentRevisionId: first.response.revision.id
    }, "admin-user");

    assert.equal(second.status, "created");
    if (second.status !== "created") return;

    const read = await readDocumentRevisionsForPartFromDatabase("part-alpha");
    assert.equal(read.status, "available");
    if (read.status !== "available") return;

    const revA = read.response.revisions.find((revision) => revision.revisionLabel === "Rev A");
    const revB = read.response.revisions.find((revision) => revision.revisionLabel === "Rev B");

    assert.ok(revA);
    assert.ok(revB);
    assert.equal(revA.lifecycleStatus, "superseded");
    assert.equal(revA.supersededByDocumentRevisionId, revB.id);
    assert.equal(revB.supersedesDocumentRevisionId, revA.id);
    assert.equal(revB.asset.fileHash, "sha256-alpha");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies redline notes can be opened and resolved without mutating the revision status.
 */
test("document control creates and resolves redline notes", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    const revision = await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "internal",
      assetId: "asset-drawing-alpha",
      documentType: "mechanical_drawing",
      lifecycleStatus: "in_review",
      revisionLabel: "Drawing 1"
    }, "reviewer-a");

    assert.equal(revision.status, "created");
    if (revision.status !== "created") return;

    const redline = await createDocumentRedlineInDatabase(revision.response.revision.id, {
      anchorText: "Zone B3",
      note: "Hole spacing dimension needs reviewer confirmation.",
      pageNumber: 2,
      severity: "blocker"
    }, "reviewer-a");

    assert.equal(redline.status, "created");
    if (redline.status !== "created") return;
    assert.equal(redline.response.redline.redlineStatus, "open");
    assert.equal(redline.response.redline.severity, "blocker");

    const resolved = await updateDocumentRedlineInDatabase(redline.response.redline.id, {
      redlineStatus: "resolved"
    }, "reviewer-b");

    assert.equal(resolved.status, "updated");
    if (resolved.status !== "updated") return;
    assert.equal(resolved.response.redline.redlineStatus, "resolved");
    assert.equal(resolved.response.redline.resolvedBy, "reviewer-b");
    assert.equal(resolved.response.documentControl.revisions[0]?.lifecycleStatus, "in_review");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies readAssetDownloadGateFromDatabase reports unrestricted when no controlled
 * revision exists on the asset.
 */
test("asset download gate is unrestricted when no controlled revision exists", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    const result = await readAssetDownloadGateFromDatabase("asset-datasheet-alpha");
    assert.equal(result.status, "decided");
    if (result.status !== "decided") return;
    assert.equal(result.gate.status, "unrestricted");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the gate reports the most-restrictive non-archived revision (ITAR over
 * plain restricted) so the route layer can block accidental controlled downloads.
 */
test("asset download gate returns the most-restrictive non-archived revision", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    // Released restricted revision
    await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "restricted",
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "released",
      revisionLabel: "Rev A",
      revisionDate: "2026-05-01"
    }, "admin-user");

    // Newer ITAR-controlled revision (should win the gate)
    await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "itar_controlled",
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "in_review",
      revisionLabel: "Rev B",
      revisionDate: "2026-05-15"
    }, "admin-user");

    const result = await readAssetDownloadGateFromDatabase("asset-datasheet-alpha");
    assert.equal(result.status, "decided");
    if (result.status !== "decided") return;
    assert.equal(result.gate.status, "gated");
    if (result.gate.status !== "gated") return;
    assert.equal(result.gate.accessLevel, "itar_controlled");
    assert.equal(result.gate.revisionLabel, "Rev B");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the gate ignores archived revisions so a stale ITAR revision cannot
 * keep gating an asset after it has been re-released to internal/public.
 */
test("asset download gate ignores archived revisions", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "itar_controlled",
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "archived",
      revisionLabel: "Rev Old",
      revisionDate: "2026-04-01"
    }, "admin-user");

    const result = await readAssetDownloadGateFromDatabase("asset-datasheet-alpha");
    assert.equal(result.status, "decided");
    if (result.status !== "decided") return;
    assert.equal(result.gate.status, "unrestricted");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a user-principal ACL grant authorizes a controlled download without acknowledgment.
 */
test("ACL grant for the user principal authorizes a gated download", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    const created = await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "itar_controlled",
      aclEntries: [
        { permission: "view", principalId: "user-7", principalType: "user" }
      ],
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "released",
      revisionLabel: "Rev A",
      revisionDate: "2026-05-01"
    }, "admin-user");

    assert.equal(created.status, "created");
    if (created.status !== "created") return;

    const grant = await readAssetDownloadAclGrant(created.response.revision.id, { userId: "user-7", role: "user" });
    assert.equal(grant.status, "granted");
    if (grant.status !== "granted") return;
    assert.equal(grant.grant.status, "acl_user");
    assert.equal(grant.grant.permission, "view");

    const noGrant = await readAssetDownloadAclGrant(created.response.revision.id, { userId: "user-9", role: "user" });
    assert.equal(noGrant.status, "no_grant");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a role-principal ACL grant authorizes the actor when the session role matches.
 */
test("ACL grant for the role principal authorizes a matching session role", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    const created = await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "restricted",
      aclEntries: [
        { permission: "view", principalId: "admin", principalType: "role" }
      ],
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "released",
      revisionLabel: "Rev R",
      revisionDate: "2026-05-01"
    }, "admin-user");

    assert.equal(created.status, "created");
    if (created.status !== "created") return;

    const grant = await readAssetDownloadAclGrant(created.response.revision.id, { userId: null, role: "admin" });
    assert.equal(grant.status, "granted");
    if (grant.status !== "granted") return;
    assert.equal(grant.grant.status, "acl_role");

    const wrongRole = await readAssetDownloadAclGrant(created.response.revision.id, { userId: null, role: "user" });
    assert.equal(wrongRole.status, "no_grant");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies review/approve permissions are not enough on their own — only view and admin
 * unlock downloads. Review permission is workflow-only and intentionally does not bypass
 * the gate.
 */
test("ACL grant with only review permission does not authorize a download", async () => {
  const pool = createDocumentControlPool();
  setDocumentControlPoolForTests(pool);

  try {
    await seedPartAndAsset(pool);

    const created = await createDocumentRevisionInDatabase("part-alpha", {
      accessLevel: "itar_controlled",
      aclEntries: [
        { permission: "review", principalId: "user-7", principalType: "user" }
      ],
      assetId: "asset-datasheet-alpha",
      documentType: "datasheet",
      lifecycleStatus: "released",
      revisionLabel: "Rev A",
      revisionDate: "2026-05-01"
    }, "admin-user");

    assert.equal(created.status, "created");
    if (created.status !== "created") return;

    const result = await readAssetDownloadAclGrant(created.response.revision.id, { userId: "user-7", role: "user" });
    assert.equal(result.status, "no_grant");
  } finally {
    setDocumentControlPoolForTests(null);
    await pool.end();
  }
});

/**
 * Seeds the minimum catalog rows needed by document-control tests.
 */
async function seedPartAndAsset(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO parts (id) VALUES ('part-alpha');
    INSERT INTO assets (
      id,
      part_id,
      asset_type,
      file_format,
      storage_key,
      file_hash,
      provenance,
      availability_status,
      source_url
    )
    VALUES
      ('asset-datasheet-alpha', 'part-alpha', 'datasheet', 'pdf', 'parts/alpha/datasheet.pdf', 'sha256-alpha', 'official', 'downloaded', 'https://example.test/ds.pdf'),
      ('asset-drawing-alpha', 'part-alpha', 'mechanical_drawing', 'pdf', 'parts/alpha/drawing.pdf', 'sha256-drawing', 'manual_internal', 'downloaded', NULL);
  `);
}

/**
 * Creates an in-memory catalog/document-control database.
 */
function createDocumentControlPool(): TestPool {
  const db = newDb();
  db.public.none(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      org_id TEXT DEFAULT 'org-default'
    );

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES parts(id),
      asset_type TEXT NOT NULL,
      file_format TEXT NOT NULL,
      storage_key TEXT,
      file_hash TEXT,
      provenance TEXT NOT NULL,
      availability_status TEXT NOT NULL,
      source_url TEXT
    );

    CREATE TABLE document_revisions (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES parts(id),
      asset_id TEXT NOT NULL REFERENCES assets(id),
      document_type TEXT NOT NULL,
      revision_label TEXT NOT NULL,
      revision_date DATE,
      lifecycle_status TEXT NOT NULL DEFAULT 'draft',
      access_level TEXT NOT NULL DEFAULT 'internal',
      access_notes TEXT NOT NULL DEFAULT '',
      effective_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      supersedes_document_revision_id TEXT REFERENCES document_revisions(id),
      source_asset_hash TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (part_id, asset_id, revision_label)
    );

    CREATE TABLE document_acl_entries (
      id TEXT PRIMARY KEY,
      document_revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (document_revision_id, principal_type, principal_id, permission)
    );

    CREATE TABLE document_redlines (
      id TEXT PRIMARY KEY,
      document_revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
      redline_status TEXT NOT NULL DEFAULT 'open',
      page_number INTEGER,
      anchor_text TEXT,
      note TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'review',
      created_by TEXT NOT NULL,
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const adapter = db.adapters.createPg();
  // Document-control gates on the part being in the acting org; run as an org-default teammate.
  enterRequestContextForTests("org-default");
  return new adapter.Pool() as TestPool;
}
