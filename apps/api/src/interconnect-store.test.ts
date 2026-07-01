/**
 * File header: Tests interconnect dashboard reads for cable assemblies, fixtures, and pin maps.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  createCableAssemblyEndInDatabase,
  createCableAssemblyInDatabase,
  createCablePinMapRowInDatabase,
  createFixturePortInDatabase,
  createTestFixtureInDatabase,
  deleteCableAssemblyEndInDatabase,
  deleteCablePinMapRowInDatabase,
  deleteFixturePortInDatabase,
  importCablePinMapRowsInDatabase,
  importFixturePortsInDatabase,
  readCableAssemblyDetailFromDatabase,
  readCableAssemblyRevisionsFromDatabase,
  readCableRevisionCompareFromDatabase,
  readFixtureRevisionCompareFromDatabase,
  readTestFixtureRevisionsFromDatabase,
  readInterconnectDashboardFromDatabase,
  readTestFixtureDetailFromDatabase,
  searchInterconnectWhereUsed,
  setInterconnectPoolForTests,
  updateCableAssemblyEndInDatabase,
  updateCableAssemblyInDatabase,
  updateCablePinMapRowInDatabase,
  updateFixturePortInDatabase,
  updateTestFixtureInDatabase
} from "./interconnect-store";
import { enterRequestContextForTests, runWithRequestContext } from "./request-context";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by interconnect tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after each test releases it. */
  end: () => Promise<void>;
};

/**
 * Verifies interconnect reads do not pretend to work without a configured database.
 */
test("readInterconnectDashboardFromDatabase returns not_configured without a database", async () => {
  setInterconnectPoolForTests(null);

  const result = await readInterconnectDashboardFromDatabase();

  assert.equal(result.status, "not_configured");
});

/**
 * Verifies the interconnect dashboard maps cable, fixture, and pin-map context together.
 */
test("readInterconnectDashboardFromDatabase returns cable, fixture, and pin-map rows", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool);

    const result = await readInterconnectDashboardFromDatabase();

    assert.equal(result.status, "available");
    if (result.status !== "available") return;

    assert.equal(result.response.state, "available");
    assert.equal(result.response.summary.cableAssemblyCount, 1);
    assert.equal(result.response.summary.fixtureCount, 1);
    assert.equal(result.response.summary.fixturePortCount, 1);
    assert.equal(result.response.summary.pinMapRowCount, 1);
    assert.equal(result.response.summary.approvedCableAssemblyCount, 1);
    assert.equal(result.response.summary.restrictedRecordCount, 1);
    assert.equal(result.response.summary.lowConfidencePinRowCount, 1);

    const cable = result.response.cableAssemblies[0];
    assert.equal(cable?.cableKey, "CAB-100");
    assert.equal(cable?.revisionLabel, "D");
    assert.equal(cable?.ends[0]?.connectorRef, "J202");
    assert.equal(cable?.ends[0]?.connectorPart.mpn, "D38999-26WJ202");
    assert.equal(cable?.pinRowCount, 1);
    assert.equal(cable?.fixturePortCount, 1);

    const fixture = result.response.fixtures[0];
    assert.equal(fixture?.fixtureKey, "TFX-42");
    assert.equal(fixture?.fixtureStatus, "restricted");
    assert.equal(fixture?.ports[0]?.connectorRef, "J202");
    assert.equal(fixture?.ports[0]?.cableKey, "CAB-100");

    const pinRow = result.response.pinMapRows[0];
    assert.equal(pinRow?.connectorRef, "J202");
    assert.equal(pinRow?.pinNumber, "47");
    assert.equal(pinRow?.signalName, "RS422_TX+");
    assert.equal(pinRow?.confidenceScore, 0.62);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

test("tenant isolation: interconnect reads and where-used are scoped to the request org", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool); // org-default: cable-cab-100 / fixture-tfx-42 / a J202 pin row

    // A second org's cable + pin row + fixture.
    await pool.query(
      `INSERT INTO cable_assemblies (id, cable_key, revision_label, assembly_status, provenance, org_id, created_at, updated_at)
       VALUES ('cable-other', 'OTHER-1', 'A', 'draft', 'manual_internal', 'org-other', now(), now())`
    );
    await pool.query(
      `INSERT INTO cable_pin_map_rows (id, cable_assembly_id, end_label, connector_ref, pin_number, signal_name, confidence_score, org_id)
       VALUES ('pin-other', 'cable-other', 'A', 'J202', '9', 'OTHER_SIG', 0.9, 'org-other')`
    );
    await pool.query(
      `INSERT INTO test_fixtures (id, fixture_key, revision_label, fixture_status, provenance, org_id, created_at, updated_at)
       VALUES ('fixture-other', 'OTHERFX', 'A', 'draft', 'manual_internal', 'org-other', now(), now())`
    );

    // org-default (the harness default context) sees only its own rows.
    const own = await readInterconnectDashboardFromDatabase();
    assert.equal(own.status, "available");
    if (own.status !== "available") return;
    assert.equal(own.response.summary.cableAssemblyCount, 1, "org-default counts only its own cable");
    assert.ok(own.response.cableAssemblies.every((c) => c.id !== "cable-other"), "org-other cable is hidden");
    assert.equal((await readCableAssemblyDetailFromDatabase("cable-other")).status, "not_found", "org-default cannot read org-other's cable");

    // where-used for a connector both orgs use (J202) returns only org-default hits.
    const ownHits = await searchInterconnectWhereUsed(pool, "J202");
    assert.ok(ownHits.length > 0, "org-default has its own J202 hits");
    assert.ok(ownHits.every((hit) => hit.cableKey !== "OTHER-1"), "org-other wiring never leaks into where-used");

    // No tenant context fails closed.
    await runWithRequestContext(null, async () => {
      const anon = await readInterconnectDashboardFromDatabase();
      assert.equal(anon.status, "available");
      if (anon.status !== "available") return;
      assert.equal(anon.response.summary.cableAssemblyCount, 0, "no tenant => no cables");
      assert.deepEqual(anon.response.cableAssemblies, []);
      assert.deepEqual(await searchInterconnectWhereUsed(pool, "J202"), []);
    });

    // org-other sees only its own cable and can read its detail, not org-default's.
    await runWithRequestContext("org-other", async () => {
      const other = await readInterconnectDashboardFromDatabase();
      assert.equal(other.status, "available");
      if (other.status !== "available") return;
      assert.equal(other.response.summary.cableAssemblyCount, 1);
      assert.ok(other.response.cableAssemblies.some((c) => c.id === "cable-other"));
      assert.equal((await readCableAssemblyDetailFromDatabase("cable-other")).status, "available");
      assert.equal((await readCableAssemblyDetailFromDatabase("cable-cab-100")).status, "not_found", "org-other cannot read org-default's cable");
    });
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a connector ref matches the pin row, cable end, and fixture port that carry it.
 */
test("searchInterconnectWhereUsed returns cable, fixture, and pin hits for a connector ref", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool);

    const hits = await searchInterconnectWhereUsed(pool, "J202");
    const kinds = hits.map((hit) => hit.kind).sort();

    assert.deepEqual(kinds, ["cable_end", "fixture_port", "pin_map_row"]);

    const pinHit = hits.find((hit) => hit.kind === "pin_map_row");
    assert.equal(pinHit?.cableKey, "CAB-100");
    assert.equal(pinHit?.pinNumber, "47");
    assert.equal(pinHit?.signalName, "RS422_TX+");
    assert.equal(pinHit?.confidenceScore, 0.62);
    assert.ok(pinHit?.matchedLabels.includes("Connector ref J202"));

    const fixtureHit = hits.find((hit) => hit.kind === "fixture_port");
    assert.equal(fixtureHit?.fixtureKey, "TFX-42");
    assert.equal(fixtureHit?.projectKey, "ALPHA");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies connector-ref matching is case-insensitive so operators do not have to match casing.
 */
test("searchInterconnectWhereUsed matches connector refs case-insensitively", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool);

    const hits = await searchInterconnectWhereUsed(pool, "j202");

    assert.ok(hits.length >= 3);
    assert.ok(hits.every((hit) => hit.matchedLabels.length > 0));
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies signal names match as a substring while a destination connector ref matches the pin row.
 */
test("searchInterconnectWhereUsed matches signal substrings and destination connector refs", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool);

    const signalHits = await searchInterconnectWhereUsed(pool, "rs422");
    assert.equal(signalHits.length, 1);
    assert.equal(signalHits[0]?.kind, "pin_map_row");
    assert.ok(signalHits[0]?.matchedLabels.includes("Signal RS422_TX+"));

    const destinationHits = await searchInterconnectWhereUsed(pool, "J201");
    assert.equal(destinationHits.length, 1);
    assert.equal(destinationHits[0]?.kind, "pin_map_row");
    assert.ok(destinationHits[0]?.matchedLabels.includes("Destination connector J201"));
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a no-match query and a blank query both return no hits rather than inventing rows.
 */
test("searchInterconnectWhereUsed returns no hits for an unknown or blank query", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool);

    assert.deepEqual(await searchInterconnectWhereUsed(pool, "J999"), []);
    assert.deepEqual(await searchInterconnectWhereUsed(pool, "   "), []);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a cable can be created and then read back as full detail.
 */
test("createCableAssemblyInDatabase persists a cable and detail read returns it", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createCableAssemblyInDatabase({ cableKey: "CAB-200", revisionLabel: "A", owner: "Dana" });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.equal(created.response.cable.cableKey, "CAB-200");
    assert.equal(created.response.cable.assemblyStatus, "draft");
    assert.equal(created.response.cable.provenance, "manual_internal");
    assert.match(created.response.boundary, /does not approve/u);

    const detail = await readCableAssemblyDetailFromDatabase(created.response.cable.id);
    assert.equal(detail.status, "available");
    if (detail.status !== "available") return;
    assert.equal(detail.response.cable.cableKey, "CAB-200");
    assert.equal(detail.response.pinRows.length, 0);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies header validation and duplicate (cable_key, revision) protection.
 */
test("createCableAssemblyInDatabase rejects empty keys and duplicate revisions", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const blank = await createCableAssemblyInDatabase({ cableKey: "   " });
    assert.equal(blank.status, "invalid");

    const first = await createCableAssemblyInDatabase({ cableKey: "CAB-300", revisionLabel: "A" });
    assert.equal(first.status, "created");
    const dup = await createCableAssemblyInDatabase({ cableKey: "CAB-300", revisionLabel: "A" });
    assert.equal(dup.status, "invalid");
    if (dup.status !== "invalid") return;
    assert.equal(dup.code, "DUPLICATE_CABLE_KEY");

    const missingProject = await createCableAssemblyInDatabase({ cableKey: "CAB-301", projectId: "project-missing" });
    assert.equal(missingProject.status, "invalid");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies retiring a cable is a status edit, never a delete.
 */
test("updateCableAssemblyInDatabase retires a cable via status and preserves the row", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createCableAssemblyInDatabase({ cableKey: "CAB-400" });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;

    const retired = await updateCableAssemblyInDatabase(created.response.cable.id, { assemblyStatus: "retired" });
    assert.equal(retired.status, "updated");
    if (retired.status !== "updated") return;
    assert.equal(retired.response.cable.assemblyStatus, "retired");

    const detail = await readCableAssemblyDetailFromDatabase(created.response.cable.id);
    assert.equal(detail.status, "available");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies ends can be added, edited, de-duplicated, and deleted.
 */
test("cable end create/update/delete enforces validation and duplicates", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createCableAssemblyInDatabase({ cableKey: "CAB-500" });
    if (created.status !== "created") throw new Error("setup failed");
    const cableId = created.response.cable.id;

    const badLabel = await createCableAssemblyEndInDatabase(cableId, { endLabel: "Z" as never, connectorRef: "J1" });
    assert.equal(badLabel.status, "invalid");

    const endResult = await createCableAssemblyEndInDatabase(cableId, { endLabel: "A", connectorRef: "J1" });
    assert.equal(endResult.status, "created");
    if (endResult.status !== "created") return;
    assert.equal(endResult.response.cable.ends.length, 1);
    const endId = endResult.response.cable.ends[0]!.id;

    const dup = await createCableAssemblyEndInDatabase(cableId, { endLabel: "A", connectorRef: "J1" });
    assert.equal(dup.status, "invalid");

    const badPart = await createCableAssemblyEndInDatabase(cableId, { endLabel: "B", connectorRef: "J2", matePartId: "part-missing" });
    assert.equal(badPart.status, "invalid");

    const edited = await updateCableAssemblyEndInDatabase(cableId, endId, { endLabel: "A", connectorRef: "J1-RENAMED" });
    assert.equal(edited.status, "updated");
    if (edited.status !== "updated") return;
    assert.equal(edited.response.cable.ends[0]!.connectorRef, "J1-RENAMED");

    const wrongCable = await updateCableAssemblyEndInDatabase("cable-does-not-exist", endId, { endLabel: "A", connectorRef: "J1" });
    assert.equal(wrongCable.status, "not_found");

    const removed = await deleteCableAssemblyEndInDatabase(cableId, endId);
    assert.equal(removed.status, "deleted");
    if (removed.status !== "deleted") return;
    assert.equal(removed.response.cable.ends.length, 0);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies pin rows can be added, validated, edited, and deleted.
 */
test("cable pin row create/update/delete enforces signal, pin, and confidence rules", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createCableAssemblyInDatabase({ cableKey: "CAB-600" });
    if (created.status !== "created") throw new Error("setup failed");
    const cableId = created.response.cable.id;

    const missingSignal = await createCablePinMapRowInDatabase(cableId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "  " });
    assert.equal(missingSignal.status, "invalid");

    const badConfidence = await createCablePinMapRowInDatabase(cableId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "GND", confidenceScore: 5 });
    assert.equal(badConfidence.status, "invalid");

    const row = await createCablePinMapRowInDatabase(cableId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "CAN_H", wireGauge: 24 });
    assert.equal(row.status, "created");
    if (row.status !== "created") return;
    assert.equal(row.response.pinRows.length, 1);
    assert.equal(row.response.pinRows[0]!.confidenceScore, 0.5);
    const rowId = row.response.pinRows[0]!.id;

    const edited = await updateCablePinMapRowInDatabase(cableId, rowId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "CAN_L" });
    assert.equal(edited.status, "updated");
    if (edited.status !== "updated") return;
    assert.equal(edited.response.pinRows[0]!.signalName, "CAN_L");

    const removed = await deleteCablePinMapRowInDatabase(cableId, rowId);
    assert.equal(removed.status, "deleted");
    if (removed.status !== "deleted") return;
    assert.equal(removed.response.pinRows.length, 0);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a fixture can be created, edited, retired, and read back as detail.
 */
test("test fixture create / update / retire persists and reads back", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createTestFixtureInDatabase({ fixtureKey: "TFX-100", revisionLabel: "A", owner: "Morgan" });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.equal(created.response.fixture.fixtureKey, "TFX-100");
    assert.equal(created.response.fixture.fixtureStatus, "draft");
    assert.equal(created.response.fixture.provenance, "manual_internal");
    assert.match(created.response.boundary, /does not approve/u);
    const fixtureId = created.response.fixture.id;

    const blank = await createTestFixtureInDatabase({ fixtureKey: "  " });
    assert.equal(blank.status, "invalid");

    const dup = await createTestFixtureInDatabase({ fixtureKey: "TFX-100", revisionLabel: "A" });
    assert.equal(dup.status, "invalid");

    const retired = await updateTestFixtureInDatabase(fixtureId, { fixtureStatus: "retired" });
    assert.equal(retired.status, "updated");
    if (retired.status !== "updated") return;
    assert.equal(retired.response.fixture.fixtureStatus, "retired");

    const detail = await readTestFixtureDetailFromDatabase(fixtureId);
    assert.equal(detail.status, "available");

    const missing = await readTestFixtureDetailFromDatabase("fixture-nope");
    assert.equal(missing.status, "not_found");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies fixture ports can be added, validated, edited, de-duplicated, and deleted.
 */
test("fixture port create / update / delete enforces validation and duplicates", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createTestFixtureInDatabase({ fixtureKey: "TFX-200" });
    if (created.status !== "created") throw new Error("setup failed");
    const fixtureId = created.response.fixture.id;

    const blank = await createFixturePortInDatabase(fixtureId, { connectorRef: "  " });
    assert.equal(blank.status, "invalid");

    const port = await createFixturePortInDatabase(fixtureId, { connectorRef: "J202", portRole: "DUT port" });
    assert.equal(port.status, "created");
    if (port.status !== "created") return;
    assert.equal(port.response.fixture.ports.length, 1);
    const portId = port.response.fixture.ports[0]!.id;

    const dup = await createFixturePortInDatabase(fixtureId, { connectorRef: "J202" });
    assert.equal(dup.status, "invalid");

    const badCable = await createFixturePortInDatabase(fixtureId, { connectorRef: "J203", cableAssemblyId: "cable-missing" });
    assert.equal(badCable.status, "invalid");

    const edited = await updateFixturePortInDatabase(fixtureId, portId, { connectorRef: "J202-RENAMED", portRole: "Power" });
    assert.equal(edited.status, "updated");
    if (edited.status !== "updated") return;
    assert.equal(edited.response.fixture.ports[0]!.connectorRef, "J202-RENAMED");

    const wrongFixture = await updateFixturePortInDatabase("fixture-nope", portId, { connectorRef: "J202" });
    assert.equal(wrongFixture.status, "not_found");

    const removed = await deleteFixturePortInDatabase(fixtureId, portId);
    assert.equal(removed.status, "deleted");
    if (removed.status !== "deleted") return;
    assert.equal(removed.response.fixture.ports.length, 0);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies revision listing and the end/pin diff between two revisions of one cable key.
 */
test("cable revision compare diffs ends and pin rows between two revisions", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const revA = await createCableAssemblyInDatabase({ cableKey: "CAB-CMP", revisionLabel: "A" });
    const revB = await createCableAssemblyInDatabase({ cableKey: "CAB-CMP", revisionLabel: "B" });
    if (revA.status !== "created" || revB.status !== "created") throw new Error("setup failed");
    const aId = revA.response.cable.id;
    const bId = revB.response.cable.id;

    await createCableAssemblyEndInDatabase(aId, { endLabel: "A", connectorRef: "J1" });
    await createCablePinMapRowInDatabase(aId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "SIG_A" });

    await createCableAssemblyEndInDatabase(bId, { endLabel: "A", connectorRef: "J1" });
    await createCablePinMapRowInDatabase(bId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "SIG_B" });
    await createCablePinMapRowInDatabase(bId, { endLabel: "A", connectorRef: "J1", pinNumber: "2", signalName: "NEW_SIG" });

    const revisions = await readCableAssemblyRevisionsFromDatabase(aId);
    assert.equal(revisions.status, "available");
    if (revisions.status !== "available") return;
    assert.equal(revisions.response.revisions.length, 2);
    assert.equal(revisions.response.cableKey, "CAB-CMP");

    const compare = await readCableRevisionCompareFromDatabase(aId, bId);
    assert.equal(compare.status, "available");
    if (compare.status !== "available") return;
    assert.equal(compare.response.baseRevisionLabel, "A");
    assert.equal(compare.response.targetRevisionLabel, "B");
    // End A is identical (J1 → J1), so no end diff.
    assert.equal(compare.response.endDiffs.length, 0);
    // Pin J1/1 changed signal, pin J1/2 added.
    const changed = compare.response.pinRowDiffs.find((diff) => diff.pinNumber === "1");
    const added = compare.response.pinRowDiffs.find((diff) => diff.pinNumber === "2");
    assert.equal(changed?.kind, "changed");
    assert.ok(changed?.changes.some((change) => change.field === "signal" && change.from === "SIG_A" && change.to === "SIG_B"));
    assert.equal(added?.kind, "added");
    assert.equal(compare.response.pinRowSummary.added, 1);
    assert.equal(compare.response.pinRowSummary.changed, 1);
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies compare refuses revisions of different cable keys and unknown ids.
 */
test("cable revision compare rejects mismatched cable keys and unknown revisions", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const a = await createCableAssemblyInDatabase({ cableKey: "CAB-AAA" });
    const b = await createCableAssemblyInDatabase({ cableKey: "CAB-BBB" });
    if (a.status !== "created" || b.status !== "created") throw new Error("setup failed");

    const mismatch = await readCableRevisionCompareFromDatabase(a.response.cable.id, b.response.cable.id);
    assert.equal(mismatch.status, "not_found");
    if (mismatch.status !== "not_found") return;
    assert.equal(mismatch.code, "CABLE_KEY_MISMATCH");

    const unknown = await readCableRevisionCompareFromDatabase(a.response.cable.id, "cable-nope");
    assert.equal(unknown.status, "not_found");

    const missingList = await readCableAssemblyRevisionsFromDatabase("cable-nope");
    assert.equal(missingList.status, "not_found");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies pin-map import adds new rows, skips duplicates and invalid rows, and tags provenance.
 */
test("importCablePinMapRowsInDatabase adds new rows and skips duplicates and invalid rows", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createCableAssemblyInDatabase({ cableKey: "CAB-IMP" });
    if (created.status !== "created") throw new Error("setup failed");
    const cableId = created.response.cable.id;

    // Seed one existing pin so an import duplicate can be detected.
    await createCablePinMapRowInDatabase(cableId, { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "EXISTING" });

    const result = await importCablePinMapRowsInDatabase(cableId, {
      sourceFilename: "CAB-IMP-pins.csv",
      rows: [
        { endLabel: "A", connectorRef: "J1", pinNumber: "1", signalName: "DUPLICATE" }, // duplicate of existing
        { endLabel: "A", connectorRef: "J1", pinNumber: "2", signalName: "CAN_H" }, // new
        { endLabel: "A", connectorRef: "J1", pinNumber: "3", signalName: "  " }, // invalid (no signal)
        { endLabel: "A", connectorRef: "J1", pinNumber: "2", signalName: "DUP_IN_BATCH" } // duplicate within batch
      ]
    });

    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    assert.equal(result.response.summary.added, 1);
    assert.equal(result.response.summary.skippedDuplicate, 2);
    assert.equal(result.response.summary.skippedInvalid, 1);
    assert.ok(result.response.summary.invalidSamples.length >= 1);

    const imported = result.response.detail.pinRows.find((row) => row.pinNumber === "2");
    assert.equal(imported?.signalName, "CAN_H");
    assert.equal(imported?.sourceDocumentRef, "CAB-IMP-pins.csv");
    assert.ok((imported?.confidenceScore ?? 1) < 0.75);

    const missing = await importCablePinMapRowsInDatabase("cable-nope", { sourceFilename: "x.csv", rows: [] });
    assert.equal(missing.status, "not_found");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies fixture port-list import adds new ports and skips duplicates and invalid rows.
 */
test("importFixturePortsInDatabase adds new ports and skips duplicates and invalid rows", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const created = await createTestFixtureInDatabase({ fixtureKey: "TFX-IMP" });
    if (created.status !== "created") throw new Error("setup failed");
    const fixtureId = created.response.fixture.id;

    await createFixturePortInDatabase(fixtureId, { connectorRef: "J1", portRole: "existing" });

    const result = await importFixturePortsInDatabase(fixtureId, {
      sourceFilename: "TFX-IMP-ports.csv",
      rows: [
        { connectorRef: "J1", portRole: "dup" }, // duplicate of existing
        { connectorRef: "J2", portRole: "DUT port" }, // new
        { connectorRef: "  ", portRole: "no ref" }, // invalid
        { connectorRef: "J2", portRole: "dup in batch" } // duplicate within batch
      ]
    });

    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    assert.equal(result.response.summary.added, 1);
    assert.equal(result.response.summary.skippedDuplicate, 2);
    assert.equal(result.response.summary.skippedInvalid, 1);

    const imported = result.response.detail.fixture.ports.find((port) => port.connectorRef === "J2");
    assert.equal(imported?.portRole, "DUT port");

    const missing = await importFixturePortsInDatabase("fixture-nope", { sourceFilename: "x.csv", rows: [] });
    assert.equal(missing.status, "not_found");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies fixture revision listing and the port diff between two revisions of one fixture key.
 */
test("fixture revision compare diffs ports between two revisions", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const revA = await createTestFixtureInDatabase({ fixtureKey: "TFX-CMP", revisionLabel: "A" });
    const revB = await createTestFixtureInDatabase({ fixtureKey: "TFX-CMP", revisionLabel: "B" });
    if (revA.status !== "created" || revB.status !== "created") throw new Error("setup failed");
    const aId = revA.response.fixture.id;
    const bId = revB.response.fixture.id;

    await createFixturePortInDatabase(aId, { connectorRef: "J1", portRole: "power" });
    await createFixturePortInDatabase(aId, { connectorRef: "J2", portRole: "data" });

    await createFixturePortInDatabase(bId, { connectorRef: "J1", portRole: "power" }); // unchanged
    await createFixturePortInDatabase(bId, { connectorRef: "J2", portRole: "data-fast" }); // changed role
    await createFixturePortInDatabase(bId, { connectorRef: "J3", portRole: "aux" }); // added

    const revisions = await readTestFixtureRevisionsFromDatabase(aId);
    assert.equal(revisions.status, "available");
    if (revisions.status !== "available") return;
    assert.equal(revisions.response.revisions.length, 2);

    const compare = await readFixtureRevisionCompareFromDatabase(aId, bId);
    assert.equal(compare.status, "available");
    if (compare.status !== "available") return;

    const changed = compare.response.portDiffs.find((diff) => diff.connectorRef === "J2");
    const added = compare.response.portDiffs.find((diff) => diff.connectorRef === "J3");
    assert.equal(changed?.kind, "changed");
    assert.ok(changed?.changes.some((change) => change.field === "role" && change.from === "data" && change.to === "data-fast"));
    assert.equal(added?.kind, "added");
    assert.equal(compare.response.portSummary.added, 1);
    assert.equal(compare.response.portSummary.changed, 1);

    const fixtureB = await createTestFixtureInDatabase({ fixtureKey: "TFX-OTHER" });
    if (fixtureB.status !== "created") throw new Error("setup failed");
    const mismatch = await readFixtureRevisionCompareFromDatabase(aId, fixtureB.response.fixture.id);
    assert.equal(mismatch.status, "not_found");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies missing-cable detail reads do not invent a record.
 */
test("readCableAssemblyDetailFromDatabase returns not_found for an unknown cable", async () => {
  const pool = createInterconnectPool();
  setInterconnectPoolForTests(pool);

  try {
    const detail = await readCableAssemblyDetailFromDatabase("cable-nope");
    assert.equal(detail.status, "not_found");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the API route returns the typed interconnect dashboard envelope.
 */
test("GET /interconnects returns the interconnect dashboard", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const pool = createInterconnectPool();
  process.env.NODE_ENV = "test";
  // Tenant scoping: handleRequest resolves the acting org from the session; the test session puts the
  // request in org-default so the dashboard returns the seeded org-default rows.
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  setInterconnectPoolForTests(pool);

  try {
    await seedInterconnectRows(pool);

    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/interconnects", handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["X-EE-Operation"], "api-interconnect-dashboard");
    assert.equal(result.body.source, "database");
    assert.equal(result.body.data.cableAssemblies[0]?.id, "cable-cab-100");
    assert.equal(result.body.data.fixtures[0]?.id, "fixture-tfx-42");
    assert.equal(result.body.data.pinMapRows[0]?.pinNumber, "47");
  } finally {
    setInterconnectPoolForTests(null);
    await pool.end();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTestAuth === undefined) delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
    else process.env.EE_LIBRARY_ALLOW_TEST_AUTH = previousTestAuth;
  }
});

/**
 * Creates an in-memory database with the tables needed by the interconnect reader.
 */
function createInterconnectPool(): TestPool {
  const db = newDb();
  db.public.none(`
    CREATE TABLE manufacturers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      mpn TEXT NOT NULL,
      manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id)
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE project_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      revision_label TEXT NOT NULL
    );

    CREATE TABLE cable_assemblies (
      id TEXT PRIMARY KEY,
      cable_key TEXT NOT NULL,
      revision_label TEXT NOT NULL,
      assembly_status TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id),
      project_revision_id TEXT REFERENCES project_revisions(id),
      owner TEXT,
      description TEXT,
      source_document_ref TEXT,
      provenance TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE cable_assembly_ends (
      id TEXT PRIMARY KEY,
      cable_assembly_id TEXT NOT NULL REFERENCES cable_assemblies(id),
      end_label TEXT NOT NULL,
      connector_ref TEXT NOT NULL,
      connector_part_id TEXT REFERENCES parts(id),
      mate_part_id TEXT REFERENCES parts(id),
      backshell_part_id TEXT REFERENCES parts(id),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE test_fixtures (
      id TEXT PRIMARY KEY,
      fixture_key TEXT NOT NULL,
      revision_label TEXT NOT NULL,
      fixture_status TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id),
      owner TEXT,
      purpose TEXT,
      source_document_ref TEXT,
      provenance TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE fixture_ports (
      id TEXT PRIMARY KEY,
      fixture_id TEXT NOT NULL REFERENCES test_fixtures(id),
      connector_ref TEXT NOT NULL,
      connector_part_id TEXT REFERENCES parts(id),
      mate_part_id TEXT REFERENCES parts(id),
      cable_assembly_id TEXT REFERENCES cable_assemblies(id),
      port_role TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE cable_pin_map_rows (
      id TEXT PRIMARY KEY,
      cable_assembly_id TEXT NOT NULL REFERENCES cable_assemblies(id),
      cable_end_id TEXT REFERENCES cable_assembly_ends(id),
      fixture_port_id TEXT REFERENCES fixture_ports(id),
      end_label TEXT NOT NULL,
      connector_ref TEXT NOT NULL,
      pin_number TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      wire_color TEXT,
      wire_gauge INTEGER,
      destination_connector_ref TEXT,
      destination_pin_number TEXT,
      confidence_score NUMERIC NOT NULL,
      evidence_attachment_id TEXT,
      source_document_ref TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Tenant isolation (2d): the interconnect tables carry org_id; parts/projects/project_revisions
    -- also (scoped by earlier increments) since rowExists validates cross-domain links by org.
    ALTER TABLE parts ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE projects ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE project_revisions ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE cable_assemblies ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE cable_assembly_ends ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE test_fixtures ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE fixture_ports ADD COLUMN org_id TEXT DEFAULT 'org-default';
    ALTER TABLE cable_pin_map_rows ADD COLUMN org_id TEXT DEFAULT 'org-default';
  `);

  const adapter = db.adapters.createPg();
  // Interconnect reads/writes are tenant-scoped; run each test body as an org-default teammate.
  enterRequestContextForTests("org-default");
  return new adapter.Pool() as TestPool;
}

/**
 * Seeds a deterministic cable-to-fixture story with one low-confidence pin row.
 */
async function seedInterconnectRows(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO manufacturers (id, name)
    VALUES
      ('manufacturer-shell', 'ShellCo'),
      ('manufacturer-mate', 'MateCo'),
      ('manufacturer-back', 'BackshellCo');

    INSERT INTO parts (id, mpn, manufacturer_id)
    VALUES
      ('part-j202', 'D38999-26WJ202', 'manufacturer-shell'),
      ('part-mate', 'D38999-20FJ202', 'manufacturer-mate'),
      ('part-back', 'M85049-88', 'manufacturer-back');

    INSERT INTO projects (id, project_key, name)
    VALUES ('project-alpha', 'ALPHA', 'Alpha Test Set');

    INSERT INTO project_revisions (id, project_id, revision_label)
    VALUES ('revision-alpha-d', 'project-alpha', 'Rev D');

    INSERT INTO cable_assemblies (
      id,
      cable_key,
      revision_label,
      assembly_status,
      project_id,
      project_revision_id,
      owner,
      description,
      source_document_ref,
      provenance,
      created_at,
      updated_at
    )
    VALUES (
      'cable-cab-100',
      'CAB-100',
      'D',
      'approved',
      'project-alpha',
      'revision-alpha-d',
      'Dana',
      'Main DUT breakout cable.',
      'CAB-100-RevD.xlsx',
      'project_file',
      '2026-06-01T12:00:00Z',
      '2026-06-10T12:00:00Z'
    );

    INSERT INTO cable_assembly_ends (
      id,
      cable_assembly_id,
      end_label,
      connector_ref,
      connector_part_id,
      mate_part_id,
      backshell_part_id,
      notes
    )
    VALUES (
      'cable-cab-100-end-a',
      'cable-cab-100',
      'A',
      'J202',
      'part-j202',
      'part-mate',
      'part-back',
      'Fixture-facing end.'
    );

    INSERT INTO test_fixtures (
      id,
      fixture_key,
      revision_label,
      fixture_status,
      project_id,
      owner,
      purpose,
      source_document_ref,
      provenance,
      created_at,
      updated_at
    )
    VALUES (
      'fixture-tfx-42',
      'TFX-42',
      'B',
      'restricted',
      'project-alpha',
      'Morgan',
      'DUT bring-up fixture.',
      'TFX-42-port-list.pdf',
      'project_file',
      '2026-06-02T12:00:00Z',
      '2026-06-11T12:00:00Z'
    );

    INSERT INTO fixture_ports (
      id,
      fixture_id,
      connector_ref,
      connector_part_id,
      mate_part_id,
      cable_assembly_id,
      port_role,
      notes
    )
    VALUES (
      'fixture-tfx-42-port-j202',
      'fixture-tfx-42',
      'J202',
      'part-j202',
      'part-mate',
      'cable-cab-100',
      'DUT port',
      'Use with Rev D cable only.'
    );

    INSERT INTO cable_pin_map_rows (
      id,
      cable_assembly_id,
      cable_end_id,
      fixture_port_id,
      end_label,
      connector_ref,
      pin_number,
      signal_name,
      wire_color,
      wire_gauge,
      destination_connector_ref,
      destination_pin_number,
      confidence_score,
      evidence_attachment_id,
      source_document_ref,
      notes,
      updated_at
    )
    VALUES (
      'pin-row-j202-47',
      'cable-cab-100',
      'cable-cab-100-end-a',
      'fixture-tfx-42-port-j202',
      'A',
      'J202',
      '47',
      'RS422_TX+',
      'blue',
      24,
      'J201',
      '12',
      0.62,
      NULL,
      'CAB-100-RevD.xlsx',
      'Copied from Rev D spreadsheet.',
      '2026-06-12T12:00:00Z'
    );
  `);
}

/**
 * Invokes the API handler with a tiny in-memory GET request/response pair.
 */
async function invokeApiGet(url: string, handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const request = Readable.from([]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let headers: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      headers = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { host: "localhost" };
  request.method = "GET";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers,
    statusCode
  };
}
