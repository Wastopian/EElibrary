/**
 * File header: Tests canonical parameter registry integrity and provider-label mapping.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PARAMETER_REGISTRY, collectCoveredMetricKeys, findParamDefForSpecKey, getCanonicalParamDefByKey, getParameterDefs, listCanonicalParameterKeys } from "./parameter-registry";
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

/**
 * Verifies regulator min/max labels stay semantically separate instead of being reconciled as
 * conflicting sources for one value, while a combined provider range retains both bounds.
 */
test("findParamDefForSpecKey preserves regulator voltage bound semantics", () => {
  assert.equal(findParamDefForSpecKey("regulator", "Voltage - Input (Min)")?.paramKey, "input_voltage_min");
  assert.equal(findParamDefForSpecKey("regulator", "Voltage - Input (Max)")?.paramKey, "input_voltage_max");
  assert.equal(findParamDefForSpecKey("regulator", "Voltage - Output (Min/Fixed)")?.paramKey, "output_voltage_min");
  assert.equal(findParamDefForSpecKey("regulator", "Voltage - Output (Max)")?.paramKey, "output_voltage_max");

  const combinedOutput = findParamDefForSpecKey("regulator", "Voltage - Output (Min/Max)");

  assert.equal(combinedOutput?.paramKey, "output_voltage_range");
  assert.equal(combinedOutput?.valueKind, "range");
});

/**
 * Verifies RAM matching only accepts RAM labels, not the "ram" character sequence inside unrelated
 * provider fields such as Frame Format or Programmable I/O Type.
 */
test("findParamDefForSpecKey does not invent RAM from unrelated MCU labels", () => {
  assert.equal(findParamDefForSpecKey("mcu", "RAM Size")?.paramKey, "ram_size");
  assert.equal(findParamDefForSpecKey("mcu", "Data RAM")?.paramKey, "ram_size");
  assert.equal(findParamDefForSpecKey("mcu", "Frame Format"), null);
  assert.equal(findParamDefForSpecKey("mcu", "Programmable I/O Type"), null);
});

/**
 * Verifies covered-metric-key collection: a parameter hides its own key plus every metricKey its def
 * folds in during recompute, falls back to the global def for unregistered part types, and never
 * covers unrelated keys.
 */
test("collectCoveredMetricKeys covers paramKey plus registry metricKeys and nothing else", () => {
  const covered = collectCoveredMetricKeys([
    { paramKey: "resistance", partType: "resistor" },
    { paramKey: "voltage_rating", partType: "capacitor" },
    { paramKey: "supply_voltage_range", partType: "mcu" }
  ]);

  assert.ok(covered.has("resistance"), "own key covered");
  assert.ok(covered.has("voltage_rating"), "def metricKey covered");
  assert.ok(covered.has("rated_voltage"), "seed-vocabulary alias covered via def metricKeys");
  assert.ok(covered.has("supply_voltage"), "MCU range covers the legacy supply-voltage metric");
  assert.equal(covered.has("input_voltage_max"), false, "unrelated metric keys stay uncovered");

  // A part type outside the registry still covers via the global def lookup.
  const fallback = collectCoveredMetricKeys([{ paramKey: "capacitance", partType: "mystery_type" }]);

  assert.ok(fallback.has("capacitance"));
  assert.deepEqual([...collectCoveredMetricKeys([])], [], "no parameters cover nothing");
});

/**
 * Verifies the flat key lookup and key enumeration used by search filtering.
 */
test("getCanonicalParamDefByKey and listCanonicalParameterKeys expose a flat, deduped key space", () => {
  assert.equal(getCanonicalParamDefByKey("resistance")?.unit, "ohm");
  assert.equal(getCanonicalParamDefByKey("package")?.valueKind, "text");
  assert.equal(getCanonicalParamDefByKey("dielectric")?.valueKind, "enum");
  assert.equal(getCanonicalParamDefByKey("not_a_real_param"), null);

  const keys = listCanonicalParameterKeys();

  assert.equal(keys.length, new Set(keys).size, "keys are deduped across part types");
  assert.ok(keys.includes("resistance") && keys.includes("capacitance") && keys.includes("package"));
});
