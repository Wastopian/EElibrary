"use client";

/**
 * File header: Interactive LED current-limit resistor calculator.
 *
 * Engineers enter supply voltage, LED forward voltage (Vf), and target LED
 * current, then see the required series resistor, the power that resistor
 * dissipates, and the nearest E96 1% values for off-the-shelf substitution.
 */

import React, { useMemo, useState } from "react";
import { SectionPanel } from "@ee-library/ui";
import { computeLedCurrentLimit, formatEngineering, nearestE96Pair } from "./lib/calculations";

/** CurrentUnit picks a multiplier so engineers can type "20" and pick "mA". */
type CurrentUnit = "µA" | "mA" | "A";

const CURRENT_UNIT_TO_AMPS: Record<CurrentUnit, number> = {
  "µA": 1e-6,
  mA: 1e-3,
  A: 1
};

/**
 * Renders the LED current-limit resistor calculator card.
 */
export function LedResistorCalculator(): React.ReactElement {
  const [supplyVoltage, setSupplyVoltage] = useState("5");
  const [forwardVoltage, setForwardVoltage] = useState("2");
  const [currentValue, setCurrentValue] = useState("20");
  const [currentUnit, setCurrentUnit] = useState<CurrentUnit>("mA");

  const forwardCurrentAmps = parseRawNumber(currentValue) * CURRENT_UNIT_TO_AMPS[currentUnit];

  const result = useMemo(
    () =>
      computeLedCurrentLimit({
        supplyVoltageVolts: parseRawNumber(supplyVoltage),
        forwardVoltageVolts: parseRawNumber(forwardVoltage),
        forwardCurrentAmps
      }),
    [supplyVoltage, forwardVoltage, forwardCurrentAmps]
  );

  return (
    <SectionPanel
      description="R = (Vsupply − Vf) / I_LED. Power = (Vsupply − Vf) × I_LED. Enter the supply voltage, LED forward voltage drop, and target current."
      title="LED current-limit resistor"
    >
      <div className="tools-calculator">
        <div className="tools-calculator__grid">
          <label className="tools-calculator__field">
            <span>Supply voltage</span>
            <div className="tools-calculator__input-row">
              <input inputMode="decimal" onChange={(event) => setSupplyVoltage(event.currentTarget.value)} type="text" value={supplyVoltage} />
              <span className="tools-calculator__unit">V</span>
            </div>
          </label>
          <label className="tools-calculator__field">
            <span>LED forward voltage (Vf)</span>
            <div className="tools-calculator__input-row">
              <input inputMode="decimal" onChange={(event) => setForwardVoltage(event.currentTarget.value)} type="text" value={forwardVoltage} />
              <span className="tools-calculator__unit">V</span>
            </div>
          </label>
          <label className="tools-calculator__field">
            <span>LED current</span>
            <div className="tools-calculator__input-row">
              <input inputMode="decimal" onChange={(event) => setCurrentValue(event.currentTarget.value)} type="text" value={currentValue} />
              <select onChange={(event) => setCurrentUnit(event.currentTarget.value as CurrentUnit)} value={currentUnit}>
                <option value="µA">µA</option>
                <option value="mA">mA</option>
                <option value="A">A</option>
              </select>
            </div>
          </label>
        </div>

        {typeof result === "string" ? (
          <p className="tools-calculator__error" role="alert">{result}</p>
        ) : (
          <dl className="tools-calculator__results">
            <div>
              <dt>Series resistor</dt>
              <dd>{formatEngineering(result.resistanceOhms, "Ω")}</dd>
            </div>
            <div>
              <dt>Nearest E96 1% values</dt>
              <dd>{formatE96Suggestions(result.resistanceOhms)}</dd>
            </div>
            <div>
              <dt>Voltage across resistor</dt>
              <dd>{formatEngineering(result.voltageAcrossResistorVolts, "V")}</dd>
            </div>
            <div>
              <dt>Resistor dissipation</dt>
              <dd>{formatEngineering(result.resistorPowerWatts, "W")}</dd>
            </div>
            <div>
              <dt>LED dissipation</dt>
              <dd>{formatEngineering(result.ledPowerWatts, "W")}</dd>
            </div>
          </dl>
        )}
      </div>
    </SectionPanel>
  );
}

/**
 * Returns the closest E96 1% resistor below and above the requested resistance.
 */
function formatE96Suggestions(resistance: number): string {
  const pair = nearestE96Pair(resistance);
  if (!pair) {
    return "—";
  }

  if (Math.abs(pair.lower - pair.upper) < pair.lower * 0.0001) {
    return formatEngineering(pair.lower, "Ω");
  }

  return `${formatEngineering(pair.lower, "Ω")} or ${formatEngineering(pair.upper, "Ω")}`;
}

/**
 * Parses a raw decimal string without throwing.
 */
function parseRawNumber(value: string): number {
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "") {
    return Number.NaN;
  }
  return Number(trimmed);
}
