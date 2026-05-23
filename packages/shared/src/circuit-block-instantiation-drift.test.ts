/**
 * File header: Tests circuit-block instantiation drift summaries against current block roles.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildCircuitBlockInstantiationPatternDrift } from "./circuit-block-instantiation-drift";
import type { BomLine, CircuitBlockPartRecord } from "./types";

/**
 * Verifies a generated BOM line matching the current required role stays clean.
 */
test("buildCircuitBlockInstantiationPatternDrift reports a matching instantiation", () => {
  const summary = buildCircuitBlockInstantiationPatternDrift({
    currentPartRoles: [buildRole()],
    includeOptional: false,
    instantiatedBomLines: [buildLine()]
  });

  assert.equal(summary.status, "matches_current_pattern");
  assert.equal(summary.currentRoleCount, 1);
  assert.equal(summary.instantiatedRoleCount, 1);
  assert.deepEqual(summary.items, []);
});

/**
 * Verifies a new required role added after reuse is surfaced as material drift.
 */
test("buildCircuitBlockInstantiationPatternDrift reports missing current roles", () => {
  const summary = buildCircuitBlockInstantiationPatternDrift({
    currentPartRoles: [
      buildRole(),
      buildRole({
        blockPartId: "cbpart-alpha-output-cap",
        mpn: "GRM188R61E106KA73D",
        partId: "part-output-cap",
        role: "Output capacitor"
      })
    ],
    includeOptional: false,
    instantiatedBomLines: [buildLine()]
  });

  assert.equal(summary.status, "drifted");
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0]?.kind, "missing_current_role");
  assert.match(summary.items[0]?.detail ?? "", /Output capacitor/u);
});

/**
 * Verifies metadata-only changes ask for review without claiming material BOM drift.
 */
test("buildCircuitBlockInstantiationPatternDrift distinguishes requirement review from drift", () => {
  const summary = buildCircuitBlockInstantiationPatternDrift({
    currentPartRoles: [buildRole({ isRequired: false })],
    includeOptional: false,
    instantiatedBomLines: [buildLine()]
  });

  assert.equal(summary.status, "needs_review");
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0]?.kind, "extra_instantiated_role");
  assert.equal(summary.items[0]?.severity, "review");
});

/**
 * Verifies a project BOM line manually changed away from the current role part is material drift.
 */
test("buildCircuitBlockInstantiationPatternDrift reports part changes", () => {
  const summary = buildCircuitBlockInstantiationPatternDrift({
    currentPartRoles: [buildRole()],
    includeOptional: false,
    instantiatedBomLines: [buildLine({ matchedPartId: "part-other-ldo", rawMpn: "OTHER-LDO" })]
  });

  assert.equal(summary.status, "drifted");
  assert.equal(summary.items[0]?.kind, "part_changed");
  assert.match(summary.items[0]?.detail ?? "", /TPS7A02DBVR/u);
});

/**
 * Builds a current circuit-block role fixture.
 */
function buildRole(overrides: Partial<{
  blockPartId: string;
  isRequired: boolean;
  mpn: string;
  partId: string;
  quantity: number | null;
  role: string;
}> = {}): CircuitBlockPartRecord {
  const partId = overrides.partId ?? "part-memory-ldo";
  const mpn = overrides.mpn ?? "TPS7A02DBVR";

  return {
    blockPart: {
      circuitBlockId: "cblock-alpha-power",
      createdAt: "2026-05-01T00:00:00.000Z",
      id: overrides.blockPartId ?? "cbpart-alpha-power-ldo",
      isRequired: overrides.isRequired ?? true,
      notes: null,
      partId,
      quantity: overrides.quantity ?? 1,
      role: overrides.role ?? "Main LDO",
      substitutionPolicy: "exact_required",
      updatedAt: "2026-05-01T00:00:00.000Z"
    },
    part: {
      approvalStatus: "approved",
      blockerCount: 0,
      connectorClass: "non_connector",
      lifecycleStatus: "active",
      manufacturerName: "Texas Instruments",
      mpn,
      partId,
      readinessStatus: "ready_for_export_review"
    }
  };
}

/**
 * Builds an instantiated BOM line fixture tied to the default current role.
 */
function buildLine(overrides: Partial<{
  matchedPartId: string | null;
  quantity: number | null;
  rawMpn: string | null;
}> = {}): BomLine {
  return {
    bomImportId: "bominst-alpha",
    createdAt: "2026-05-01T00:01:00.000Z",
    designators: ["U1"],
    id: "line-inst-alpha-ldo",
    instantiatedAt: "2026-05-01T00:01:00.000Z",
    instantiatedFromCircuitBlockId: "cblock-alpha-power",
    instantiatedFromCircuitBlockPartId: "cbpart-alpha-power-ldo",
    matchConfidenceScore: 1,
    matchedPartId: overrides.matchedPartId === undefined ? "part-memory-ldo" : overrides.matchedPartId,
    matchStatus: overrides.matchedPartId === null ? "unmatched" : "matched",
    projectId: "project-alpha",
    projectRevisionId: "rev-alpha-a",
    quantity: overrides.quantity ?? 1,
    rawDescription: "Instantiated role",
    rawManufacturer: "Texas Instruments",
    rawMpn: overrides.rawMpn === undefined ? "TPS7A02DBVR" : overrides.rawMpn,
    rawNotes: null,
    rawRowPayload: {
      circuitBlockPartRole: "Main LDO",
      isRequired: true
    },
    rawSupplierReference: null,
    rowNumber: 1,
    updatedAt: "2026-05-01T00:01:00.000Z"
  };
}
