/**
 * File header: Tests seed-free connector intelligence and search helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildBuildableMatingSet, formatAssetAvailabilityStatus, formatAssetExportStatus, formatAssetStatus, getExportAvailability, getPartDetail, getSearchFacets } from "./search";
import type { AccessoryRequirement, CableCompatibility, MateRelation } from "./types";

/**
 * Builds a fully typed mate relation so tests can opt into direct or inferred evidence explicitly.
 */
function buildMateRelation(overrides: Partial<MateRelation> = {}): MateRelation {
  return {
    compatibilityStatus: "verified",
    confidenceScore: 0.9,
    evidenceKind: "manual_review",
    id: "mate-test",
    matePartId: "part-b",
    notes: null,
    partId: "part-a",
    relationshipType: "best_mate",
    sourceRecordId: "source-test",
    sourceRevisionId: "dsr-test",
    ...overrides
  };
}

/**
 * Builds a fully typed accessory relation so tests can opt into direct or inferred evidence explicitly.
 */
function buildAccessoryRequirement(overrides: Partial<AccessoryRequirement> = {}): AccessoryRequirement {
  return {
    accessoryPartId: "part-accessory",
    compatibilityStatus: "verified",
    confidenceScore: 0.85,
    evidenceKind: "manual_review",
    id: "accessory-test",
    notes: null,
    partId: "part-a",
    relationshipType: "requires_accessory",
    sourceRecordId: "source-test",
    sourceRevisionId: "dsr-test",
    ...overrides
  };
}

/**
 * Builds a fully typed cable compatibility row so tests stay aligned with the shared contract.
 */
function buildCableCompatibility(overrides: Partial<CableCompatibility> = {}): CableCompatibility {
  return {
    cablePartId: "part-cable",
    compatibilityStatus: "probable",
    confidenceScore: 0.8,
    id: "cable-test",
    notes: null,
    partId: "part-a",
    relationshipType: "supports_cable",
    shieldingRequirement: "unknown",
    sourceRecordId: null,
    sourceRevisionId: "dsr-test",
    terminationStyle: "unknown",
    wireGaugeMax: null,
    wireGaugeMin: null,
    ...overrides
  };
}

test("connector record exposes typed buildable mating set", () => {
  const record = getPartDetail("part-te-215079-8");

  assert.ok(record, "expected seeded connector part");
  assert.equal(record.buildableMatingSet.bestMate?.relationshipType, "best_mate");
  assert.equal(Array.isArray(record.buildableMatingSet.alternateMates), true);
  assert.equal(record.buildableMatingSet.requiredAccessories.length >= 2, true);
  assert.equal(Array.isArray(record.buildableMatingSet.optionalAccessories), true);
  assert.equal(record.buildableMatingSet.cableOptions[0]?.relationshipType, "supports_cable");
  assert.equal(record.accessoryRequirements.some((item) => item.relationshipType === "tooling_requirement"), true);
  assert.equal(typeof record.buildableMatingSet.confidenceScore, "number");
  assert.equal(typeof record.buildableMatingSet.confidenceBreakdown.overallScore, "number");
  assert.equal(record.buildableMatingSet.cableAssumptions.length > 0, true);
  assert.equal(Array.isArray(record.buildableMatingSet.warningDetails), true);
});

test("buildable mating set tie-breaks equal-confidence records deterministically", () => {
  const matingSet = buildBuildableMatingSet(
    [
      buildMateRelation({ id: "mate-b", matePartId: "part-b" }),
      buildMateRelation({ id: "mate-a", matePartId: "part-a" })
    ],
    [],
    []
  );

  assert.equal(matingSet.bestMate?.id, "mate-a");
});

test("buildable mating set excludes alternate mates and sorts accessories and cables", () => {
  const matingSet = buildBuildableMatingSet(
    [
      buildMateRelation({
        confidenceScore: 0.99,
        id: "mate-alternate",
        matePartId: "part-alt",
        relationshipType: "alternate_mate"
      }),
      buildMateRelation({
        confidenceScore: 0.7,
        id: "mate-best",
        matePartId: "part-best"
      })
    ],
    [
      buildAccessoryRequirement({
        accessoryPartId: "part-required-b",
        confidenceScore: 0.7,
        id: "required-b"
      }),
      buildAccessoryRequirement({
        accessoryPartId: "part-tooling",
        confidenceScore: 0.95,
        id: "tooling-a",
        relationshipType: "tooling_requirement"
      }),
      buildAccessoryRequirement({
        accessoryPartId: "part-required-a",
        confidenceScore: 0.7,
        id: "required-a"
      }),
      buildAccessoryRequirement({
        accessoryPartId: "part-optional",
        confidenceScore: 1,
        id: "optional-a",
        relationshipType: "optional_accessory"
      })
    ],
    [
      buildCableCompatibility({
        cablePartId: "part-cable-b",
        confidenceScore: 0.6,
        id: "cable-b"
      }),
      buildCableCompatibility({
        cablePartId: "part-cable-a",
        confidenceScore: 0.8,
        id: "cable-a"
      })
    ]
  );

  assert.equal(matingSet.bestMate?.id, "mate-best");
  assert.deepEqual(matingSet.alternateMates.map((item) => item.id), ["mate-alternate"]);
  assert.deepEqual(matingSet.optionalAccessories.map((item) => item.id), ["optional-a"]);
  assert.deepEqual(matingSet.requiredAccessories.map((item) => item.id), ["required-a", "required-b"]);
  assert.deepEqual(matingSet.toolingRequirements.map((item) => item.id), ["tooling-a"]);
  assert.deepEqual(matingSet.cableOptions.map((item) => item.id), ["cable-a", "cable-b"]);
  assert.equal(matingSet.warnings.length > 0, true);
  assert.match(matingSet.warnings[0] ?? "", /70%/u);
  assert.equal(matingSet.confidenceBreakdown.bestMateScore, 0.7);
  assert.equal(matingSet.confidenceBreakdown.cableScore, 0.7);
  assert.equal(matingSet.confidenceBreakdown.evidenceCount, 7);
  assert.equal(matingSet.warningDetails.some((warning) => warning.code === "best_mate_low_confidence"), true);
});

test("buildable mating set parses cable assumptions and surfaces near-match alternates", () => {
  const matingSet = buildBuildableMatingSet(
    [
      buildMateRelation({
        confidenceScore: 0.91,
        id: "mate-best",
        matePartId: "part-best",
        notes: "Primary keyed mate."
      }),
      buildMateRelation({
        confidenceScore: 0.86,
        id: "mate-alt",
        matePartId: "part-alt",
        notes: "Close family alternative with different latch orientation.",
        relationshipType: "alternate_mate"
      })
    ],
    [],
    [
      buildCableCompatibility({
        cablePartId: "part-cable-a",
        confidenceScore: 0.82,
        id: "cable-a",
        notes: "Compatible 28 AWG shielded cable for IDC termination in vibration-prone harnesses."
      })
    ]
  );

  assert.equal(matingSet.cableAssumptions.some((assumption) => assumption.type === "wire_gauge"), true);
  assert.equal(matingSet.cableAssumptions.some((assumption) => assumption.type === "shielding"), true);
  assert.equal(matingSet.cableAssumptions.some((assumption) => assumption.type === "termination_style"), true);
  assert.equal(matingSet.cableAssumptions.some((assumption) => assumption.type === "environment"), true);
  assert.equal(matingSet.warningDetails.some((warning) => warning.code === "near_match_alternates"), true);
});

test("family-inferred mate evidence lowers effective confidence and counts inferred evidence", () => {
  const matingSet = buildBuildableMatingSet(
    [
      buildMateRelation({
        compatibilityStatus: "probable",
        confidenceScore: 0.95,
        evidenceKind: "family_inference",
        id: "mate-inferred",
        matePartId: "part-inferred"
      })
    ],
    [],
    []
  );

  assert.equal((matingSet.confidenceBreakdown.bestMateScore ?? 1) < 0.75, true);
  assert.equal(matingSet.confidenceBreakdown.inferredEvidenceCount, 1);
  assert.equal(matingSet.warningDetails.some((warning) => warning.code === "best_mate_low_confidence"), true);
});

test("buildable mating set prefers persisted cable constraints over note parsing", () => {
  const matingSet = buildBuildableMatingSet(
    [],
    [],
    [
      buildCableCompatibility({
        cablePartId: "part-cable-structured",
        compatibilityStatus: "verified",
        id: "cable-structured",
        notes: "Outdoor harness use is acceptable.",
        shieldingRequirement: "shielded",
        terminationStyle: "idc",
        wireGaugeMax: 26,
        wireGaugeMin: 24
      })
    ]
  );

  assert.equal(
    matingSet.cableAssumptions.some((assumption) => assumption.type === "wire_gauge" && /24-26 AWG/u.test(assumption.summary)),
    true
  );
  assert.equal(
    matingSet.cableAssumptions.some((assumption) => assumption.type === "shielding" && /requires shielded cable construction/u.test(assumption.summary)),
    true
  );
  assert.equal(
    matingSet.cableAssumptions.some((assumption) => assumption.type === "termination_style" && /IDC-style termination/u.test(assumption.summary)),
    true
  );
  assert.equal(
    matingSet.cableAssumptions.some(
      (assumption) => assumption.type === "environment" && /Outdoor harness use is acceptable/u.test(assumption.sourceNote)
    ),
    true
  );
});

test("buildable mating set surfaces persisted family-confusion warnings", () => {
  const matingSet = buildBuildableMatingSet(
    [],
    [],
    [],
    [
      {
        candidateConnectorFamilyId: "cf-other",
        candidatePartId: "part-alt",
        confidenceScore: 0.88,
        conflictType: "family_confusion",
        detail: "part-alt is stored as a close alternate, but its connector family differs from the prioritized family.",
        id: "conflict-a",
        lastUpdatedAt: "2026-04-16T00:00:00.000Z",
        partId: "part-a",
        sourceRecordId: "source-a",
        summary: "Alternate mate crosses connector-family boundaries."
      }
    ]
  );

  assert.equal(matingSet.familyConflicts.length, 1);
  assert.equal(matingSet.warningDetails.some((warning) => warning.code === "family_confusion"), true);
  assert.equal(matingSet.warningDetails.find((warning) => warning.code === "family_confusion")?.detail.includes("connector family differs"), true);
});

test("export availability requires file-backed assets verified for export", () => {
  const record = getPartDetail("part-te-215079-8");

  assert.ok(record, "expected seeded connector part");
  assert.equal(getExportAvailability(record).find((action) => action.id === "altium")?.available, true);
  assert.equal(getExportAvailability(record).find((action) => action.id === "solidworks")?.available, false);
  assert.equal(getExportAvailability(record).find((action) => action.id === "neutral_cad")?.available, false);
});

test("asset status labels stay explicit and honest", () => {
  assert.equal(formatAssetAvailabilityStatus("referenced"), "Referenced only");
  assert.equal(formatAssetExportStatus("partially_exportable"), "Partially exportable");
  assert.equal(formatAssetStatus("missing"), "Missing");
  assert.equal(formatAssetStatus("validated"), "Validated");
  assert.equal(formatAssetStatus("verified_for_export"), "Verified for export");
});

test("facets still return normalized search data", () => {
  const facets = getSearchFacets();

  assert.equal(facets.manufacturers.length > 0, true);
  assert.equal(facets.packages.length > 0, true);
  assert.equal(facets.readinessStatuses.length > 0, true);
  assert.equal(facets.approvalStatuses.length > 0, true);
  assert.equal(facets.connectorClasses.length > 0, true);
});
