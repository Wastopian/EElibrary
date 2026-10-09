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
 * Verifies a generic earlier column does not steal the MPN field from a more specific header.
 * Auto-import paths persist this suggestion without asking, then match on the chosen column.
 */
test("BOM column suggestion prefers the most specific MPN header", () => {
  const preview = buildBomImportPreview({
    rawContent: "Designator,Part,Part Number,Manufacturer Part Number,Qty,Count\nU1,PN-1001,INT-42,TPS7A02DBVR,2,8\n",
    sourceFilename: "board.csv",
    sourceFormat: "csv"
  });

  assert.equal(preview.suggestedMapping.mpn, "Manufacturer Part Number");
  assert.equal(preview.suggestedMapping.designators, "Designator");
  assert.equal(preview.suggestedMapping.quantity, "Qty");

  const drafts = mapBomRowsToDrafts(preview.rowsPreview, preview.suggestedMapping);

  assert.equal(drafts[0]?.rawMpn, "TPS7A02DBVR");
  assert.equal(drafts[0]?.quantity, 2);

  const legacy = buildBomImportPreview({
    rawContent: "Designator,Part,Qty\nU1,TPS7A02DBVR,2\n",
    sourceFilename: "legacy.csv",
    sourceFormat: "csv"
  });

  assert.equal(legacy.suggestedMapping.mpn, "Part");
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
