import test from "node:test";
import assert from "node:assert/strict";
import { buildBuildableMatingSet, formatAssetAvailabilityStatus, formatAssetExportStatus, formatAssetStatus, getExportAvailability, getPartDetail, getSearchFacets } from "./search";

test("connector record exposes typed buildable mating set", () => {
  const record = getPartDetail("part-te-215079-8");

  assert.ok(record, "expected seeded connector part");
  assert.equal(record.buildableMatingSet.bestMate?.relationshipType, "best_mate");
  assert.equal(record.buildableMatingSet.requiredAccessories.length >= 2, true);
  assert.equal(record.buildableMatingSet.cableOptions[0]?.relationshipType, "supports_cable");
  assert.equal(record.accessoryRequirements.some((item) => item.relationshipType === "tooling_requirement"), true);
});

test("buildable mating set tie-breaks equal-confidence records deterministically", () => {
  const matingSet = buildBuildableMatingSet(
    [
      {
        confidenceScore: 0.9,
        id: "mate-b",
        matePartId: "part-b",
        notes: null,
        partId: "part-a",
        relationshipType: "best_mate",
        sourceRevisionId: "dsr-test"
      },
      {
        confidenceScore: 0.9,
        id: "mate-a",
        matePartId: "part-a",
        notes: null,
        partId: "part-a",
        relationshipType: "best_mate",
        sourceRevisionId: "dsr-test"
      }
    ],
    [],
    []
  );

  assert.equal(matingSet.bestMate?.id, "mate-a");
});

test("buildable mating set excludes alternate mates and sorts accessories and cables", () => {
  const matingSet = buildBuildableMatingSet(
    [
      {
        confidenceScore: 0.99,
        id: "mate-alternate",
        matePartId: "part-alt",
        notes: null,
        partId: "part-a",
        relationshipType: "alternate_mate",
        sourceRevisionId: "dsr-test"
      },
      {
        confidenceScore: 0.7,
        id: "mate-best",
        matePartId: "part-best",
        notes: null,
        partId: "part-a",
        relationshipType: "best_mate",
        sourceRevisionId: "dsr-test"
      }
    ],
    [
      {
        accessoryPartId: "part-required-b",
        confidenceScore: 0.7,
        id: "required-b",
        notes: null,
        partId: "part-a",
        relationshipType: "requires_accessory",
        sourceRevisionId: "dsr-test"
      },
      {
        accessoryPartId: "part-tooling",
        confidenceScore: 0.95,
        id: "tooling-a",
        notes: null,
        partId: "part-a",
        relationshipType: "tooling_requirement",
        sourceRevisionId: "dsr-test"
      },
      {
        accessoryPartId: "part-required-a",
        confidenceScore: 0.7,
        id: "required-a",
        notes: null,
        partId: "part-a",
        relationshipType: "requires_accessory",
        sourceRevisionId: "dsr-test"
      },
      {
        accessoryPartId: "part-optional",
        confidenceScore: 1,
        id: "optional-a",
        notes: null,
        partId: "part-a",
        relationshipType: "optional_accessory",
        sourceRevisionId: "dsr-test"
      }
    ],
    [
      {
        cablePartId: "part-cable-b",
        confidenceScore: 0.6,
        id: "cable-b",
        notes: null,
        partId: "part-a",
        relationshipType: "supports_cable",
        sourceRevisionId: "dsr-test"
      },
      {
        cablePartId: "part-cable-a",
        confidenceScore: 0.8,
        id: "cable-a",
        notes: null,
        partId: "part-a",
        relationshipType: "supports_cable",
        sourceRevisionId: "dsr-test"
      }
    ]
  );

  assert.equal(matingSet.bestMate?.id, "mate-best");
  assert.deepEqual(matingSet.requiredAccessories.map((item) => item.id), ["required-a", "required-b"]);
  assert.deepEqual(matingSet.toolingRequirements.map((item) => item.id), ["tooling-a"]);
  assert.deepEqual(matingSet.cableOptions.map((item) => item.id), ["cable-a", "cable-b"]);
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
});
