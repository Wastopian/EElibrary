/**
 * File header: Tests canonical parameter registry integrity and provider-label mapping.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PARAMETER_REGISTRY, findParamDefForSpecKey, getParameterDefs } from "./parameter-registry";
import type { PartType } from "./part-type";

const ALL_PART_TYPES: PartType[] = ["resistor", "capacitor", "inductor", "diode", "mcu", "regulator", "connector", "other"];

/**
 * Verifies every registry entry is internally consistent.
 */
test("parameter registry entries are internally consistent", () => {
  for (const partType of ALL_PART_TYPES) {
    const defs = getParameterDefs(partType);
    const seenKeys = new Set<string>();

    for (const def of defs) {
      assert.equal(seenKeys.has(def.paramKey), false, `${partType}.${def.paramKey} duplicated`);
      seenKeys.add(def.paramKey);
      assert.ok(def.specKeyPatterns.length > 0, `${partType}.${def.paramKey} has no patterns`);

      for (const pattern of def.specKeyPatterns) {
        assert.equal(pattern, pattern.toLowerCase(), `pattern "${pattern}" must be lowercase`);
      }

      assert.equal(def.valueKind === "enum", def.enumValues !== undefined, `${partType}.${def.paramKey} enumValues must be present iff enum`);
    }
  }

  assert.deepEqual(Object.keys(PARAMETER_REGISTRY).sort(), [...ALL_PART_TYPES].sort());
});

/**
 * Verifies representative provider labels map to the expected canonical parameters.
 */
test("findParamDefForSpecKey maps provider labels to canonical params, most-specific first", () => {
  assert.equal(findParamDefForSpecKey("resistor", "Resistance")?.paramKey, "resistance");
  assert.equal(findParamDefForSpecKey("resistor", "Tolerance")?.paramKey, "tolerance");
  assert.equal(findParamDefForSpecKey("resistor", "Power Rating")?.paramKey, "power_rating");
  assert.equal(findParamDefForSpecKey("resistor", "Overload Voltage (Max)")?.paramKey, "voltage_rating");
  assert.equal(findParamDefForSpecKey("resistor", "Package / Case")?.paramKey, "package");
  // "case code" is more specific than "case" and must win.
  assert.equal(findParamDefForSpecKey("resistor", "Case Code (Imperial)")?.paramKey, "package");
  assert.equal(findParamDefForSpecKey("capacitor", "Dielectric")?.paramKey, "dielectric");
  assert.equal(findParamDefForSpecKey("inductor", "DCR")?.paramKey, "dc_resistance");
  assert.equal(findParamDefForSpecKey("resistor", "Unrelated Attribute"), null);
});
