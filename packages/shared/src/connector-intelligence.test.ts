/**
 * File header: Tests connector buildable-set and intent resolution helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectorSetIntentText, resolveConnectorSetIntent } from "./connector-intelligence";
import { getAllPartRecords } from "./search";

/**
 * Verifies resolver candidates keep confidence, warnings, and pending accessory coverage explicit.
 */
test("resolveConnectorSetIntent returns buildable candidates with explicit confidence and warnings", () => {
  const resolution = resolveConnectorSetIntent(
    {
      cableGauge: 28,
      class: "Micro-MaTch 8",
      pinCount: 8,
      query: "Micro-MaTch",
      sealing: null
    },
    getAllPartRecords()
  );

  assert.equal(resolution.state, "available");
  assert.equal(resolution.candidates.length > 0, true);

  const candidate = resolution.candidates[0]!;
  assert.equal(candidate.connector.mpn, "215079-8");
  assert.equal(candidate.mate?.part.mpn, "215083-8");
  assert.equal(candidate.requiredAccessories.length > 0, true);
  assert.equal(candidate.cableOption?.part.mpn, "1513400800");
  assert.equal(candidate.buildabilityState, "buildable");
  assert.equal(candidate.confidenceScore > 0, true);
  assert.deepEqual(candidate.familyConfusionWarnings, []);
});

/**
 * Verifies missing required accessories degrade a matched connector to pending instead of disappearing.
 */
test("resolveConnectorSetIntent marks matched connectors pending when accessory coverage is missing", () => {
  const records = getAllPartRecords().map((record) =>
    record.part.id === "part-te-215079-8"
      ? {
          ...record,
          buildableMatingSet: {
            ...record.buildableMatingSet,
            requiredAccessories: []
          }
        }
      : record
  );
  const resolution = resolveConnectorSetIntent({ class: "Micro-MaTch", pinCount: 8 }, records);

  assert.equal(resolution.state, "available");
  assert.equal(resolution.candidates[0]?.buildabilityState, "pending");
  assert.equal(resolution.candidates[0]?.requiredAccessories.length, 0);
});

/**
 * Verifies free-text connector intent extracts build constraints without losing the family phrase.
 */
test("parseConnectorSetIntentText extracts family, pins, sealing, and AWG from engineer text", () => {
  const intent = parseConnectorSetIntentText("sealed JST PH 4 pin connector for 24 AWG");

  assert.equal(intent?.class, "JST PH");
  assert.equal(intent?.pinCount, 4);
  assert.equal(intent?.sealing, "sealed");
  assert.equal(intent?.cableGauge, 24);
});

/**
 * Verifies free-text parsing feeds resolver matching when structured fields are absent.
 */
test("resolveConnectorSetIntent uses parsed free-text constraints when class contains the full phrase", () => {
  const resolution = resolveConnectorSetIntent({ class: "Micro-MaTch 8 pin 28 AWG", query: "Micro-MaTch 8 pin 28 AWG" }, getAllPartRecords());

  assert.equal(resolution.intent.class, "Micro-MaTch");
  assert.equal(resolution.intent.pinCount, 8);
  assert.equal(resolution.intent.cableGauge, 28);
  assert.equal(resolution.candidates[0]?.connector.mpn, "215079-8");
});

/**
 * Locks the contract the bounded connector-intent fetch relies on: resolver output depends only
 * on the connector-class candidates plus the relation target parts they reference. Dropping every
 * other (unrelated, non-connector) catalog record must not change the resolution. If a future
 * change makes the resolver read more of the catalog, this fails — and the API-side
 * `readConnectorIntentRecordsFromDatabase` reduction would need to widen to match.
 */
test("resolveConnectorSetIntent output depends only on the connector candidate + relation closure", () => {
  const intent = { cableGauge: 28, class: "Micro-MaTch 8", pinCount: 8, query: "Micro-MaTch", sealing: null };
  const all = getAllPartRecords();
  const full = resolveConnectorSetIntent(intent, all);

  // Build the exact closure readConnectorIntentRecordsFromDatabase fetches: connector-class
  // records, plus the mate/accessory/cable target parts they reference.
  const closureIds = new Set<string>();
  for (const record of all) {
    if (record.readinessSummary.connectorClass !== "connector") {
      continue;
    }
    closureIds.add(record.part.id);
    const mating = record.buildableMatingSet;
    for (const relation of [mating.bestMate, ...mating.alternateMates]) {
      if (relation) {
        closureIds.add(relation.matePartId);
      }
    }
    for (const accessory of [...mating.requiredAccessories, ...mating.optionalAccessories, ...mating.toolingRequirements]) {
      closureIds.add(accessory.accessoryPartId);
    }
    for (const cable of mating.cableOptions) {
      closureIds.add(cable.cablePartId);
    }
  }

  const closure = all.filter((record) => closureIds.has(record.part.id));
  const bounded = resolveConnectorSetIntent(intent, closure);

  assert.equal(closure.length < all.length, true, "closure must exclude unrelated non-connector parts (the whole point)");
  assert.deepEqual(bounded, full);
});
