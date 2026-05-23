/**
 * File header: Tests the deterministic KiCad library emitter. Pins the S-expression scanning
 * (string-aware, offset-accurate), the symbol merge with collision renaming, footprint/3D handling,
 * generated library tables, omission accounting, and byte-for-byte determinism — the invariant the
 * reproducible/signable bundle pipeline depends on.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFpLibTable,
  buildSymLibTable,
  emitKicadLibrary,
  extractSymbolsFromLibrary,
  parseFirstForm,
  sanitizeKicadIdentifier,
  type KicadEmissionPart
} from "./kicad-library";

const SYMBOL_LIB_R = `(kicad_symbol_lib (version 20211014) (generator kicad)
  (symbol "R_0402" (property "Reference" "R" (at 0 0 0)) (property "Value" "R" (at 0 0 0)))
)
`;

const SYMBOL_LIB_C = `(kicad_symbol_lib (version 20211014) (generator kicad)
  (symbol "C_0402" (property "Reference" "C" (at 0 0 0)))
)
`;

const FOOTPRINT_R = `(footprint "R_0402" (layer "F.Cu") (pad "1" smd roundrect (at -0.48 0)))
`;

function symbolPart(partId: string, mpn: string, symbolContent: string): KicadEmissionPart {
  return { mpn, partId, symbol: { assetId: `${partId}-sym`, content: symbolContent } };
}

test("parseFirstForm reads the root list and its head", () => {
  const root = parseFirstForm(SYMBOL_LIB_R);
  assert.ok(root);
  assert.equal(root.head, "kicad_symbol_lib");
});

test("extractSymbolsFromLibrary pulls the named symbol out of the wrapper", () => {
  const symbols = extractSymbolsFromLibrary(SYMBOL_LIB_R);
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0]!.name, "R_0402");
  assert.match(symbols[0]!.span, /^\(symbol "R_0402"/u);
});

test("extractSymbolsFromLibrary handles multiple symbols in one library", () => {
  const lib = `(kicad_symbol_lib (version 20211014) (generator kicad)
  (symbol "A" (property "Reference" "A"))
  (symbol "B" (property "Reference" "B"))
)`;
  const symbols = extractSymbolsFromLibrary(lib);
  assert.deepEqual(symbols.map((symbol) => symbol.name), ["A", "B"]);
});

test("extractSymbolsFromLibrary is string-aware: parens and quotes inside strings do not break scanning", () => {
  const lib = `(kicad_symbol_lib (version 1) (generator kicad)
  (symbol "Tricky" (property "Desc" "value with ) paren and \\" quote"))
)`;
  const symbols = extractSymbolsFromLibrary(lib);
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0]!.name, "Tricky");
  // The whole symbol form, including the string with the stray ')' must be captured.
  assert.match(symbols[0]!.span, /paren and/u);
});

test("emitKicadLibrary merges symbols from multiple parts into one library file", () => {
  const result = emitKicadLibrary({
    libraryName: "proj",
    parts: [symbolPart("part-r", "RES-1", SYMBOL_LIB_R), symbolPart("part-c", "CAP-1", SYMBOL_LIB_C)]
  });

  const symbolFile = result.textFiles.find((file) => file.path === "symbols/proj.kicad_sym");
  assert.ok(symbolFile, "expected a merged symbol library");
  assert.match(symbolFile.content, /^\(kicad_symbol_lib /u);
  assert.match(symbolFile.content, /\(symbol "R_0402"/u);
  assert.match(symbolFile.content, /\(symbol "C_0402"/u);
  assert.equal(result.omittedParts.length, 0);
});

test("emitKicadLibrary renames colliding symbol names deterministically", () => {
  const result = emitKicadLibrary({
    libraryName: "proj",
    parts: [symbolPart("part-a", "RES-A", SYMBOL_LIB_R), symbolPart("part-b", "RES-B", SYMBOL_LIB_R)]
  });

  assert.equal(result.symbolCollisions.length, 1);
  assert.equal(result.symbolCollisions[0]!.originalName, "R_0402");
  assert.equal(result.symbolCollisions[0]!.renamedTo, "R_0402_2");

  const symbolFile = result.textFiles.find((file) => file.path === "symbols/proj.kicad_sym");
  assert.match(symbolFile!.content, /\(symbol "R_0402"/u);
  assert.match(symbolFile!.content, /\(symbol "R_0402_2"/u);
});

test("emitKicadLibrary writes one footprint file per part into the .pretty library", () => {
  const result = emitKicadLibrary({
    libraryName: "proj",
    parts: [{ footprint: { assetId: "fp", content: FOOTPRINT_R }, mpn: "RES-1", partId: "part-r" }]
  });

  const footprint = result.textFiles.find((file) => file.path === "footprints/proj.pretty/RES-1.kicad_mod");
  assert.ok(footprint, "expected a footprint file named after the MPN");
  assert.match(footprint.content, /\(footprint "R_0402"/u);

  const fpTable = result.textFiles.find((file) => file.path === "fp-lib-table");
  assert.match(fpTable!.content, /proj\.pretty/u);
});

test("emitKicadLibrary records a 3D model copy instruction without needing the bytes", () => {
  const result = emitKicadLibrary({
    libraryName: "proj",
    parts: [{ model3d: { assetId: "model-1", fileName: "RES_0402.step" }, mpn: "RES-1", partId: "part-r" }]
  });

  assert.deepEqual(result.modelRefs, [{ assetId: "model-1", path: "3dmodels/RES_0402.step" }]);
  assert.equal(result.includedParts[0]!.modelFile, "RES_0402.step");
});

test("emitKicadLibrary lists parts with no verified assets as omitted", () => {
  const result = emitKicadLibrary({
    libraryName: "proj",
    parts: [{ mpn: "EMPTY-1", partId: "part-empty" }, symbolPart("part-r", "RES-1", SYMBOL_LIB_R)]
  });

  assert.equal(result.omittedParts.length, 1);
  assert.equal(result.omittedParts[0]!.partId, "part-empty");
  assert.equal(result.includedParts.length, 1);

  const readme = result.textFiles.find((file) => file.path === "README.md");
  assert.match(readme!.content, /Omitted parts/u);
  assert.match(readme!.content, /EMPTY-1/u);
});

test("emitKicadLibrary always emits both library tables and a readme", () => {
  const result = emitKicadLibrary({ libraryName: "proj", parts: [] });
  const paths = result.textFiles.map((file) => file.path);
  assert.ok(paths.includes("sym-lib-table"));
  assert.ok(paths.includes("fp-lib-table"));
  assert.ok(paths.includes("README.md"));
});

test("emitKicadLibrary is deterministic regardless of input order", () => {
  const parts = [symbolPart("part-c", "CAP-1", SYMBOL_LIB_C), symbolPart("part-r", "RES-1", SYMBOL_LIB_R)];
  const first = emitKicadLibrary({ generatedAt: "2026-05-23T00:00:00.000Z", libraryName: "proj", parts });
  const second = emitKicadLibrary({
    generatedAt: "2026-05-23T00:00:00.000Z",
    libraryName: "proj",
    parts: [...parts].reverse()
  });
  assert.deepEqual(first.textFiles, second.textFiles);
  assert.deepEqual(first.modelRefs, second.modelRefs);
});

test("sanitizeKicadIdentifier keeps safe characters and collapses the rest", () => {
  assert.equal(sanitizeKicadIdentifier("DEMO-POCKET MCU!"), "DEMO-POCKET_MCU");
  assert.equal(sanitizeKicadIdentifier("  spaced  "), "spaced");
});

test("library tables degrade to empty-but-valid tables when nothing was emitted", () => {
  assert.match(buildSymLibTable("proj", false), /\(sym_lib_table/u);
  assert.doesNotMatch(buildSymLibTable("proj", false), /\(lib /u);
  assert.match(buildFpLibTable("proj", true), /\(lib /u);
});
