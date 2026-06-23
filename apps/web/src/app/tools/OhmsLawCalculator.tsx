"use client";

/**
 * File header: Interactive Ohm's Law + Power calculator.
 *
 * Engineers pick any two of {V, I, R, P}, enter the values with engineering
 * units, and see the remaining two derived live.
 */

import React, { useMemo, useState } from "react";
import { SectionPanel } from "@ee-library/ui";
import { formatEngineering, solveOhmsLaw, type OhmsLawQuantity, type OhmsLawResult } from "./lib/calculations";

/** QuantityChoice describes one selectable Ohm's-law quantity for the form. */
interface QuantityChoice {
  /** Internal id used when comparing two selections. */
  quantity: OhmsLawQuantity;
  /** Short label shown in the dropdown. */
  label: string;
  /** Long descriptive name shown in the input row. */
  longName: string;
  /** SI unit symbol used when formatting results. */
  unit: string;
  /** Unit options the engineer can pick from. */
  unitOptions: Array<{ label: string; multiplier: number }>;
}

const QUANTITY_CHOICES: ReadonlyArray<QuantityChoice> = [
  {
    quantity: "voltage",
    label: "Voltage (V)",
    longName: "Voltage",
    unit: "V",
    unitOptions: [
      { label: "µV", multiplier: 1e-6 },
      { label: "mV", multiplier: 1e-3 },
      { label: "V", multiplier: 1 },
      { label: "kV", multiplier: 1e3 }
    ]
  },
  {
    quantity: "current",
    label: "Current (I)",
    longName: "Current",
    unit: "A",
    unitOptions: [
      { label: "µA", multiplier: 1e-6 },
      { label: "mA", multiplier: 1e-3 },
      { label: "A", multiplier: 1 }
    ]
  },
  {
    quantity: "resistance",
    label: "Resistance (R)",
    longName: "Resistance",
    unit: "Ω",
    unitOptions: [
      { label: "Ω", multiplier: 1 },
      { label: "kΩ", multiplier: 1e3 },
      { label: "MΩ", multiplier: 1e6 }
    ]
  },
  {
    quantity: "power",
    label: "Power (P)",
    longName: "Power",
    unit: "W",
    unitOptions: [
      { label: "µW", multiplier: 1e-6 },
      { label: "mW", multiplier: 1e-3 },
      { label: "W", multiplier: 1 },
      { label: "kW", multiplier: 1e3 }
    ]
  }
];

/**
 * Renders the Ohm's-law calculator card.
 */
export function OhmsLawCalculator(): React.ReactElement {
  const [firstQuantity, setFirstQuantity] = useState<OhmsLawQuantity>("voltage");
  const [firstValue, setFirstValue] = useState("5");
  const [firstUnit, setFirstUnit] = useState("V");

  const [secondQuantity, setSecondQuantity] = useState<OhmsLawQuantity>("current");
  const [secondValue, setSecondValue] = useState("10");
  const [secondUnit, setSecondUnit] = useState("mA");

  const firstChoice = findChoice(firstQuantity);
  const secondChoice = findChoice(secondQuantity);

  const result = useMemo(() => {
    const firstMultiplier = lookupMultiplier(firstChoice, firstUnit);
    const secondMultiplier = lookupMultiplier(secondChoice, secondUnit);
    return solveOhmsLaw(
      { quantity: firstQuantity, value: parseRawNumber(firstValue) * firstMultiplier },
      { quantity: secondQuantity, value: parseRawNumber(secondValue) * secondMultiplier }
    );
  }, [firstQuantity, firstValue, firstUnit, secondQuantity, secondValue, secondUnit, firstChoice, secondChoice]);

  return (
    <SectionPanel
      description="V = I × R · P = V × I. Pick any two of voltage, current, resistance, and power, and the other two are computed."
      title="Ohm's Law + Power"
    >
      <div className="tools-calculator">
        <div className="tools-calculator__grid">
          <QuantitySelector
            choice={firstChoice}
            onQuantityChange={(quantity) => {
              setFirstQuantity(quantity);
              setFirstUnit(findChoice(quantity).unitOptions[0]?.label ?? findChoice(quantity).unit);
            }}
            onUnitChange={setFirstUnit}
            onValueChange={setFirstValue}
            quantitySelectId="ohms-law-known-1"
            unit={firstUnit}
            value={firstValue}
          />
          <QuantitySelector
            choice={secondChoice}
            disabledQuantity={firstQuantity}
            onQuantityChange={(quantity) => {
              setSecondQuantity(quantity);
              setSecondUnit(findChoice(quantity).unitOptions[0]?.label ?? findChoice(quantity).unit);
            }}
            onUnitChange={setSecondUnit}
            onValueChange={setSecondValue}
            quantitySelectId="ohms-law-known-2"
            unit={secondUnit}
            value={secondValue}
          />
        </div>

        {typeof result === "string" ? (
          <p className="tools-calculator__error" role="alert">{result}</p>
        ) : (
          <OhmsLawResults
            knownQuantities={[firstQuantity, secondQuantity]}
            result={result}
          />
        )}
      </div>
    </SectionPanel>
  );
}

/**
 * Renders one paired quantity + value + unit row.
 */
function QuantitySelector({
  choice,
  disabledQuantity,
  onQuantityChange,
  onUnitChange,
  onValueChange,
  quantitySelectId,
  unit,
  value
}: {
  choice: QuantityChoice;
  disabledQuantity?: OhmsLawQuantity;
  onQuantityChange: (quantity: OhmsLawQuantity) => void;
  onUnitChange: (unit: string) => void;
  onValueChange: (value: string) => void;
  quantitySelectId: string;
  unit: string;
  value: string;
}): React.ReactElement {
  return (
    <label className="tools-calculator__field">
      <span>Known quantity</span>
      <div className="tools-calculator__input-row">
        <select
          aria-label="Quantity"
          id={quantitySelectId}
          onChange={(event) => onQuantityChange(event.currentTarget.value as OhmsLawQuantity)}
          value={choice.quantity}
        >
          {QUANTITY_CHOICES.map((candidate) => (
            <option disabled={disabledQuantity === candidate.quantity} key={candidate.quantity} value={candidate.quantity}>
              {candidate.label}
            </option>
          ))}
        </select>
        <input
          aria-label={`${choice.longName} value`}
          inputMode="decimal"
          onChange={(event) => onValueChange(event.currentTarget.value)}
          type="text"
          value={value}
        />
        <select aria-label={`${choice.longName} unit`} onChange={(event) => onUnitChange(event.currentTarget.value)} value={unit}>
          {choice.unitOptions.map((option) => (
            <option key={option.label} value={option.label}>{option.label}</option>
          ))}
        </select>
      </div>
    </label>
  );
}

/**
 * Renders the four-row result block, highlighting which two values were derived.
 */
function OhmsLawResults({ knownQuantities, result }: { knownQuantities: OhmsLawQuantity[]; result: OhmsLawResult }): React.ReactElement {
  const isKnown = (quantity: OhmsLawQuantity) => knownQuantities.includes(quantity);

  return (
    <dl className="tools-calculator__results">
      <div>
        <dt>Voltage (V){isKnown("voltage") ? " — known" : ""}</dt>
        <dd>{formatEngineering(result.voltage, "V")}</dd>
      </div>
      <div>
        <dt>Current (I){isKnown("current") ? " — known" : ""}</dt>
        <dd>{formatEngineering(result.current, "A")}</dd>
      </div>
      <div>
        <dt>Resistance (R){isKnown("resistance") ? " — known" : ""}</dt>
        <dd>{formatEngineering(result.resistance, "Ω")}</dd>
      </div>
      <div>
        <dt>Power (P){isKnown("power") ? " — known" : ""}</dt>
        <dd>{formatEngineering(result.power, "W")}</dd>
      </div>
    </dl>
  );
}

/**
 * Looks up a quantity's metadata by enum value.
 */
function findChoice(quantity: OhmsLawQuantity): QuantityChoice {
  return QUANTITY_CHOICES.find((candidate) => candidate.quantity === quantity) ?? QUANTITY_CHOICES[0]!;
}

/**
 * Returns the multiplier for a chosen unit label, defaulting to 1 if not found.
 */
function lookupMultiplier(choice: QuantityChoice, unitLabel: string): number {
  return choice.unitOptions.find((option) => option.label === unitLabel)?.multiplier ?? 1;
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
