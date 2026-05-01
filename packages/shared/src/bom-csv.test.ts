/**
 * File header: Tests CSV BOM parsing and mapping behavior for project memory imports.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildBomImportPreview, mapBomRowsToDrafts, parseBomCsv } from "./bom-csv";

/**
 * Verifies CSV preview handles quoted cells, blank rows, and repeated designator cells.
 */
test("BOM CSV preview parses headers, quoted cells, blanks, and repeated designators", () => {
  const preview = buildBomImportPreview({
    rawContent: "Designators,MPN,Manufacturer,Qty,Description\n\"U1 U2\",TPS7A02DBVR,Texas Instruments,2,\"LDO, low noise\"\n\nR1;R2,RC0603FR-0710KL,Yageo,2,10k resistor\n",
    sourceFilename: "alpha.csv",
    sourceFormat: "csv"
  });

  assert.deepEqual(preview.headers, ["Designators", "MPN", "Manufacturer", "Qty", "Description"]);
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.skippedBlankRowCount, 1);
  assert.equal(preview.suggestedMapping.mpn, "MPN");
  assert.equal(preview.rowsPreview[0]?.values.Description, "LDO, low noise");

  const drafts = mapBomRowsToDrafts(parseBomCsv("Designators,MPN,Qty\nU1 U2,TPS7A02DBVR,2\nR1;R2,RC0603FR-0710KL,2\n").rows, {
    designators: "Designators",
    mpn: "MPN",
    quantity: "Qty"
  });

  assert.deepEqual(drafts[0]?.designators, ["U1", "U2"]);
  assert.deepEqual(drafts[1]?.designators, ["R1", "R2"]);
  assert.equal(drafts[0]?.quantity, 2);
});

/**
 * Verifies malformed CSV fails clearly instead of producing misleading row data.
 */
test("BOM CSV preview rejects malformed quoted fields", () => {
  assert.throws(
    () =>
      buildBomImportPreview({
        rawContent: "MPN,Qty\n\"TPS7A02DBVR,1\n",
        sourceFilename: "bad.csv",
        sourceFormat: "csv"
      }),
    /unterminated quoted field/u
  );
});
