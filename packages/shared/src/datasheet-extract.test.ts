/**
 * File header: Tests confirm-by-search of distributor parameter values against datasheet text.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { confirmDatasheetParameters, type DatasheetConfirmationCandidate } from "./datasheet-extract";

const RESISTANCE: DatasheetConfirmationCandidate = { paramKey: "resistance", unit: "ohm", valueKind: "numeric", valueNumeric: 10_000, valueText: null };
const TOLERANCE_1: DatasheetConfirmationCandidate = { paramKey: "tolerance", unit: "%", valueKind: "numeric", valueNumeric: 1, valueText: null };
const TOLERANCE_5: DatasheetConfirmationCandidate = { paramKey: "tolerance", unit: "%", valueKind: "numeric", valueNumeric: 5, valueText: null };
const POWER: DatasheetConfirmationCandidate = { paramKey: "power_rating", unit: "W", valueKind: "numeric", valueNumeric: 0.1, valueText: null };
const CAPACITANCE: DatasheetConfirmationCandidate = { paramKey: "capacitance", unit: "F", valueKind: "numeric", valueNumeric: 100e-9, valueText: null };
const PACKAGE: DatasheetConfirmationCandidate = { paramKey: "package", unit: null, valueKind: "text", valueNumeric: null, valueText: "0603" };

/** A datasheet-like text spread across "layout" whitespace, containing some values but not others. */
const DATASHEET_TEXT = "RC_L series ± 0.1%, ± 0. 5%, ± 1% Sizes 0402 / 0603 / 0805 Value = 10 K Ω Power 0.1W";

/**
 * Verifies confirmation returns only the candidates whose value appears in the datasheet text.
 */
test("confirmDatasheetParameters confirms values present in the datasheet, ignores absent ones", () => {
  const confirmed = confirmDatasheetParameters(DATASHEET_TEXT, [RESISTANCE, TOLERANCE_1, POWER, PACKAGE, CAPACITANCE]);
  const keys = confirmed.map((candidate) => candidate.paramKey).sort();

  assert.deepEqual(keys, ["package", "power_rating", "resistance", "tolerance"]);
  assert.equal(confirmed.some((candidate) => candidate.paramKey === "capacitance"), false, "an absent value is not confirmed");
});

/**
 * Verifies a value that does not appear (wrong tolerance) is not confirmed — no false corroboration.
 */
test("confirmDatasheetParameters does not confirm a value the datasheet lacks", () => {
  // The text lists ±1% (and ±0.1%, ±0.5%) but not ±5%.
  const confirmed = confirmDatasheetParameters("Tolerance ± 1% only", [TOLERANCE_5]);

  assert.deepEqual(confirmed, []);
});

/**
 * Verifies confirmation is silent on junk / empty text.
 */
test("confirmDatasheetParameters returns nothing for junk or empty text", () => {
  assert.deepEqual(confirmDatasheetParameters("The quick brown fox.", [RESISTANCE, TOLERANCE_1]), []);
  assert.deepEqual(confirmDatasheetParameters("", [PACKAGE]), []);
});

/**
 * Verifies the SI/unit form generator matches common datasheet spellings across unit families.
 */
test("confirmDatasheetParameters matches SI and unit spellings", () => {
  assert.equal(confirmDatasheetParameters("Resistance 10kΩ", [RESISTANCE]).length, 1, "compact ohm form");
  assert.equal(confirmDatasheetParameters("Rated 10000 ohms", [RESISTANCE]).length, 1, "plain number + unit");
  assert.equal(confirmDatasheetParameters("Power rating 1/10W", [POWER]).length, 1, "power fraction form");
  assert.equal(confirmDatasheetParameters("Power 100 mW", [POWER]).length, 1, "milliwatt form");
  assert.equal(confirmDatasheetParameters("Capacitance 100 nF", [CAPACITANCE]).length, 1, "nanofarad form");
});
