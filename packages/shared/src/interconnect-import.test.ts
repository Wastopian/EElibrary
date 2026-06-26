/**
 * File header: Tests pin-map column-mapping suggestion and row mapping.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mapPinMapRowsToInputs, mapPortListRowsToInputs, suggestPinMapColumnMapping, suggestPortListColumnMapping } from "./interconnect-import";
import type { BomImportPreviewRow } from "./types";

test("suggestPinMapColumnMapping maps source and destination columns separately", () => {
  const mapping = suggestPinMapColumnMapping(["Connector", "Pin", "Signal", "Wire Color", "AWG", "To Connector", "To Pin", "End"]);

  assert.equal(mapping.connectorRef, "Connector");
  assert.equal(mapping.pinNumber, "Pin");
  assert.equal(mapping.signalName, "Signal");
  assert.equal(mapping.wireColor, "Wire Color");
  assert.equal(mapping.wireGauge, "AWG");
  assert.equal(mapping.destinationConnectorRef, "To Connector");
  assert.equal(mapping.destinationPinNumber, "To Pin");
  assert.equal(mapping.endLabel, "End");
});

test("mapPinMapRowsToInputs applies the mapping, defaults end to A, and coerces gauge", () => {
  const rows: BomImportPreviewRow[] = [
    { rowNumber: 1, values: { Connector: "J202", Pin: "47", Signal: "RS422_TX+", "Wire Color": "blue", AWG: "26 AWG", "To Connector": "J201", "To Pin": "12" } }
  ];
  const mapping = suggestPinMapColumnMapping(Object.keys(rows[0]!.values));

  const inputs = mapPinMapRowsToInputs(rows, mapping);

  assert.equal(inputs.length, 1);
  const input = inputs[0]!;
  assert.equal(input.connectorRef, "J202");
  assert.equal(input.pinNumber, "47");
  assert.equal(input.signalName, "RS422_TX+");
  assert.equal(input.wireColor, "blue");
  assert.equal(input.wireGauge, 26);
  assert.equal(input.destinationConnectorRef, "J201");
  assert.equal(input.destinationPinNumber, "12");
  assert.equal(input.endLabel, "A");
});

test("suggestPortListColumnMapping maps connector, role, and notes columns", () => {
  const mapping = suggestPortListColumnMapping(["Connector", "Port Role", "Notes"]);
  assert.equal(mapping.connectorRef, "Connector");
  assert.equal(mapping.portRole, "Port Role");
  assert.equal(mapping.notes, "Notes");
});

test("mapPortListRowsToInputs applies the mapping and blanks unmapped optionals", () => {
  const rows: BomImportPreviewRow[] = [{ rowNumber: 1, values: { Connector: "J202", "Port Role": "DUT port" } }];
  const inputs = mapPortListRowsToInputs(rows, { connectorRef: "Connector", notes: null, portRole: "Port Role" });

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]!.connectorRef, "J202");
  assert.equal(inputs[0]!.portRole, "DUT port");
  assert.equal(inputs[0]!.notes, null);
});

test("mapPinMapRowsToInputs leaves required fields blank when unmapped so the API can reject them", () => {
  const rows: BomImportPreviewRow[] = [{ rowNumber: 1, values: { Pin: "5" } }];
  const inputs = mapPinMapRowsToInputs(rows, {
    connectorRef: null,
    destinationConnectorRef: null,
    destinationPinNumber: null,
    endLabel: null,
    pinNumber: "Pin",
    signalName: null,
    wireColor: null,
    wireGauge: null
  });

  assert.equal(inputs[0]!.connectorRef, "");
  assert.equal(inputs[0]!.signalName, "");
  assert.equal(inputs[0]!.pinNumber, "5");
  assert.equal(inputs[0]!.wireGauge, null);
});
