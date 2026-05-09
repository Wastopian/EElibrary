/**
 * File header: Tests evidence target picker helpers for deterministic target filtering.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceTargetPickerOptionKey, filterEvidenceTargetPickerOptions, formatEvidenceTargetTypeLabel, getEvidenceTargetPlaceholder, readEvidenceTargetType } from "./evidence-target-picker";
import type { EvidenceTargetPickerOption } from "./evidence-target-picker";

/**
 * Verifies target type parsing rejects unsupported DOM values.
 */
test("readEvidenceTargetType defaults invalid values to project", () => {
  assert.equal(readEvidenceTargetType("part"), "part");
  assert.equal(readEvidenceTargetType("unexpected"), "project");
});

/**
 * Verifies picker filtering searches ids, labels, detail text, and source text.
 */
test("filterEvidenceTargetPickerOptions filters by type and searchable text", () => {
  const options: EvidenceTargetPickerOption[] = [
    {
      detail: "ALPHA row 1 - matched - U1",
      label: "TPS7A02DBVR",
      source: "BOM lines",
      targetId: "line-alpha-1",
      targetType: "bom_line"
    },
    {
      detail: "Texas Instruments - part id part-memory-ldo",
      label: "TPS7A02DBVR",
      source: "Catalog",
      targetId: "part-memory-ldo",
      targetType: "part"
    }
  ];

  const filteredOptions = filterEvidenceTargetPickerOptions(options, "bom_line", "u1");

  assert.equal(filteredOptions.length, 1);
  assert.equal(filteredOptions[0]?.targetId, "line-alpha-1");
});

/**
 * Verifies picker labels and keys stay stable for form rendering.
 */
test("evidence target picker labels and keys are deterministic", () => {
  assert.equal(buildEvidenceTargetPickerOptionKey("risk_finding", "project-alpha:bom-health:missing_verified_cad"), "risk_finding:project-alpha:bom-health:missing_verified_cad");
  assert.equal(formatEvidenceTargetTypeLabel("project_part_usage"), "Project usage");
  assert.match(getEvidenceTargetPlaceholder("risk_finding"), /finding/u);
});
