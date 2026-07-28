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
  assert.equal(confirmDatasheetParameters("Capacitance 100 µF", [{ ...CAPACITANCE, valueNumeric: 100e-6 }]).length, 1, "micro-sign form");
});

/**
 * Verifies the MCU/regulator vocabulary confirms against real datasheet spellings: clock in MHz,
 * memory as "Kbytes"/"KB", and small currents — without confirming a wrong magnitude or unit.
 */
test("confirmDatasheetParameters matches frequency, memory-size, and current spellings", () => {
  const CLOCK: DatasheetConfirmationCandidate = { paramKey: "clock_frequency", unit: "Hz", valueKind: "numeric", valueNumeric: 64_000_000, valueText: null };
  const FLASH: DatasheetConfirmationCandidate = { paramKey: "flash_size", unit: "B", valueKind: "numeric", valueNumeric: 64_000, valueText: null };
  const QUIESCENT: DatasheetConfirmationCandidate = { paramKey: "quiescent_current", unit: "A", valueKind: "numeric", valueNumeric: 25e-9, valueText: null };

  assert.equal(confirmDatasheetParameters("frequency up to 64 MHz", [CLOCK]).length, 1, "spaced MHz");
  assert.equal(confirmDatasheetParameters("64MHz Arm Cortex-M0+", [CLOCK]).length, 1, "attached MHz");
  assert.equal(confirmDatasheetParameters("up to 64 Kbytes of Flash memory", [FLASH]).length, 1, "spelled-out Kbytes");
  assert.equal(confirmDatasheetParameters("Flash 64KB", [FLASH]).length, 1, "compact KB");
  assert.equal(confirmDatasheetParameters("IQ of only 25 nA (typ)", [QUIESCENT]).length, 1, "nanoamp form");
  assert.deepEqual(confirmDatasheetParameters("32 MHz oscillator, 128 Kbytes flash", [CLOCK, FLASH]), [], "different magnitudes are not confirmed");
  assert.deepEqual(confirmDatasheetParameters("64 mA output drive", [CLOCK]), [], "the unit must match, not just the number");
});

/**
 * Verifies the matcher does not false-confirm: a value must appear with its own unit and boundaries.
 */
test("confirmDatasheetParameters avoids substring, wrong-unit, and in-token false matches", () => {
  // "1%" must not be read out of "0.1%" / "±0.1%".
  assert.deepEqual(confirmDatasheetParameters("Tolerance options ±0.1%, ±0.5%", [TOLERANCE_1]), []);
  // A 10 kOhm value must not match a 10 kV mention (different unit).
  assert.deepEqual(confirmDatasheetParameters("Maximum working voltage 10 kV", [RESISTANCE]), []);
  // "0603" must not match inside a longer part number.
  assert.deepEqual(confirmDatasheetParameters("Ordering code RC0603FR-0710KL", [PACKAGE]), []);
  // A bare number without the unit must not confirm.
  assert.deepEqual(confirmDatasheetParameters("Figure 10 shows the 10 K test setup", [RESISTANCE]), []);
});
