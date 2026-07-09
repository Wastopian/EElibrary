/**
 * File header: Tests the coarse part-type classifier over seed and free-text provider categories.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolvePartType } from "./part-type";

/**
 * Verifies category text resolves to the expected part type, including connector delegation.
 */
test("resolvePartType classifies seed and provider category strings", () => {
  const cases: Array<{ category: string; connectorFamilyId: string | null; expected: string }> = [
    { category: "Resistors / Chip Resistor - Surface Mount", connectorFamilyId: null, expected: "resistor" },
    { category: "Capacitor", connectorFamilyId: null, expected: "capacitor" },
    { category: "Inductors, Coils, Chokes", connectorFamilyId: null, expected: "inductor" },
    { category: "Ferrite Bead", connectorFamilyId: null, expected: "inductor" },
    { category: "Diodes - Rectifiers", connectorFamilyId: null, expected: "diode" },
    { category: "Power management", connectorFamilyId: null, expected: "regulator" },
    { category: "Microcontroller", connectorFamilyId: null, expected: "mcu" },
    { category: "Connector", connectorFamilyId: null, expected: "connector" },
    { category: "USB", connectorFamilyId: "cf-usb-c", expected: "connector" },
    { category: "Connector accessory", connectorFamilyId: null, expected: "other" },
    { category: "Connector tooling", connectorFamilyId: null, expected: "other" },
    { category: "Something unclassified", connectorFamilyId: null, expected: "other" }
  ];

  for (const testCase of cases) {
    assert.equal(
      resolvePartType({ category: testCase.category, connectorFamilyId: testCase.connectorFamilyId }),
      testCase.expected,
      `expected "${testCase.category}" to resolve to ${testCase.expected}`
    );
  }
});
