/**
 * File header: Deterministic KiCad library emitter.
 *
 * This module **packages** verified, file-backed KiCad assets into a drop-in KiCad library tree. It
 * does NOT generate symbol/footprint geometry from metadata — generated CAD stays out of scope and
 * the honesty discipline (imported ≠ approved ≠ export-ready, generated ≠ official) is preserved by
 * the caller, which must only pass assets that are verified for export.
 *
 * The emitter is a pure function over text inputs so it is fully unit-testable with no database,
 * storage, or Node-only dependencies. The worker resolves verified asset bytes and feeds the symbol
 * (`.kicad_sym`) and footprint (`.kicad_mod`) text in; 3D model bytes are copied by the worker using
 * the {@link KicadEmissionResult.modelRefs} the emitter returns.
 *
 * Output layout (a standard KiCad project library tree):
 *
 *   symbols/<lib>.kicad_sym              one merged symbol library (all parts' symbols)
 *   footprints/<lib>.pretty/<mpn>.kicad_mod   one footprint per file (KiCad's .pretty convention)
 *   3dmodels/<file>                      verified 3D models, copied verbatim (paths not rewritten in v1)
 *   sym-lib-table                        registers the symbol library (relative to ${KIPRJMOD})
 *   fp-lib-table                         registers the footprint library
 *   README.md                            provenance: what was included, what was omitted and why
 */

/** KICAD_LIBRARY_GENERATOR is the generator tag written into emitted library files. */
const KICAD_LIBRARY_GENERATOR = "ee_library";

/**
 * Default symbol-library format version emitted when no source library declares one. KiCad reads the
 * `(version ...)` token on the `kicad_symbol_lib` wrapper; we prefer a source file's declared version
 * (see {@link mergeKicadSymbolLibraries}) and fall back to this known-good value otherwise.
 */
const DEFAULT_KICAD_SYMBOL_LIB_VERSION = "20211014";

/** KicadEmissionAssetInput carries one verified asset's content for a part. */
export interface KicadEmissionAssetInput {
  /** Canonical asset id, preserved for provenance and 3D model copy resolution. */
  assetId: string;
  /** Raw file content. Required for symbol/footprint (text); omitted for 3D models (binary, copied by worker). */
  content?: string;
  /** Original file name, used to name copied 3D models. */
  fileName?: string;
}

/** KicadEmissionPart is one part and whichever verified KiCad assets it has. */
export interface KicadEmissionPart {
  partId: string;
  mpn: string;
  manufacturer?: string | null;
  /** Verified `.kicad_sym` content, when present. */
  symbol?: KicadEmissionAssetInput | null;
  /** Verified `.kicad_mod` content, when present. */
  footprint?: KicadEmissionAssetInput | null;
  /** Verified 3D model reference (bytes copied by the worker), when present. */
  model3d?: KicadEmissionAssetInput | null;
}

/** KicadEmissionInput is the full request to emit one library. */
export interface KicadEmissionInput {
  /** Library nickname (e.g. a project key); sanitized to a KiCad-safe identifier. */
  libraryName: string;
  /** Deterministic ISO timestamp recorded in the README (caller supplies for reproducibility). */
  generatedAt?: string | undefined;
  parts: KicadEmissionPart[];
}

/** KicadEmittedTextFile is one generated text file (symbol lib, footprint, table, readme). */
export interface KicadEmittedTextFile {
  path: string;
  content: string;
}

/** KicadEmittedModelRef points the worker at a 3D model asset to copy into the tree verbatim. */
export interface KicadEmittedModelRef {
  /** Destination path inside the library tree. */
  path: string;
  /** Source asset id whose bytes the worker copies to {@link path}. */
  assetId: string;
}

/** KicadIncludedPart summarizes one part that contributed at least one asset. */
export interface KicadIncludedPart {
  partId: string;
  mpn: string;
  symbolNames: string[];
  footprintFile: string | null;
  modelFile: string | null;
}

/** KicadOmittedPart records a part that contributed nothing (no verified KiCad assets). */
export interface KicadOmittedPart {
  partId: string;
  mpn: string;
  reason: string;
}

/** KicadSymbolCollision records a symbol name that was renamed to keep the merged library unambiguous. */
export interface KicadSymbolCollision {
  originalName: string;
  renamedTo: string;
  partId: string;
}

/** KicadEmissionResult is the complete deterministic output of {@link emitKicadLibrary}. */
export interface KicadEmissionResult {
  /** Generated text files (always includes the readme and both lib tables). */
  textFiles: KicadEmittedTextFile[];
  /** 3D model copy instructions for the worker. */
  modelRefs: KicadEmittedModelRef[];
  /** Parts that contributed at least one asset. */
  includedParts: KicadIncludedPart[];
  /** Parts that contributed nothing. */
  omittedParts: KicadOmittedPart[];
  /** Symbol renames applied to avoid name collisions across parts. */
  symbolCollisions: KicadSymbolCollision[];
  /** Sanitized library nickname actually used in paths and tables. */
  libraryName: string;
}

/**
 * Emits a deterministic KiCad library tree from the supplied parts and their verified assets.
 *
 * Parts and their assets are processed in a stable order (sorted by mpn then partId) so identical
 * input always yields byte-identical output — a prerequisite for the reproducible/signable bundle
 * pipeline this feeds into.
 */
export function emitKicadLibrary(input: KicadEmissionInput): KicadEmissionResult {
  const libraryName = sanitizeKicadIdentifier(input.libraryName) || "ee_library";
  const sortedParts = [...input.parts].sort(comparePartsForEmission);

  const includedParts: KicadIncludedPart[] = [];
  const omittedParts: KicadOmittedPart[] = [];
  const symbolCollisions: KicadSymbolCollision[] = [];
  const modelRefs: KicadEmittedModelRef[] = [];
  const footprintFiles: KicadEmittedTextFile[] = [];

  const usedSymbolNames = new Set<string>();
  const usedFootprintFiles = new Set<string>();
  const collectedSymbols: CollectedSymbol[] = [];

  for (const part of sortedParts) {
    const symbolText = readAssetContent(part.symbol);
    const footprintText = readAssetContent(part.footprint);
    const hasModel = Boolean(part.model3d?.assetId);

    if (!symbolText && !footprintText && !hasModel) {
      omittedParts.push({
        mpn: part.mpn,
        partId: part.partId,
        reason: "No verified file-backed KiCad symbol, footprint, or 3D model is available for export."
      });
      continue;
    }

    const symbolNames: string[] = [];
    if (symbolText) {
      for (const extracted of extractSymbolsFromLibrary(symbolText)) {
        const uniqueName = ensureUniqueName(extracted.name, usedSymbolNames);
        if (uniqueName !== extracted.name) {
          symbolCollisions.push({ originalName: extracted.name, partId: part.partId, renamedTo: uniqueName });
        }
        usedSymbolNames.add(uniqueName);
        symbolNames.push(uniqueName);
        collectedSymbols.push({ name: uniqueName, span: renameSymbolSpan(extracted, uniqueName) });
      }
    }

    let footprintFile: string | null = null;
    if (footprintText) {
      const baseName = ensureUniqueFileStem(sanitizeKicadIdentifier(part.mpn) || part.partId, usedFootprintFiles);
      usedFootprintFiles.add(baseName);
      footprintFile = `${baseName}.kicad_mod`;
      footprintFiles.push({
        content: ensureTrailingNewline(footprintText),
        path: `footprints/${libraryName}.pretty/${footprintFile}`
      });
    }

    let modelFile: string | null = null;
    if (part.model3d?.assetId) {
      const modelFileName = sanitizeModelFileName(part.model3d.fileName, part.mpn, part.partId);
      modelFile = modelFileName;
      modelRefs.push({ assetId: part.model3d.assetId, path: `3dmodels/${modelFileName}` });
    }

    includedParts.push({
      footprintFile,
      modelFile,
      mpn: part.mpn,
      partId: part.partId,
      symbolNames
    });
  }

  const symbolLibVersion = readFirstDeclaredSymbolLibVersion(sortedParts) ?? DEFAULT_KICAD_SYMBOL_LIB_VERSION;

  const textFiles: KicadEmittedTextFile[] = [];

  if (collectedSymbols.length > 0) {
    textFiles.push({
      content: buildMergedSymbolLibrary(collectedSymbols, symbolLibVersion),
      path: `symbols/${libraryName}.kicad_sym`
    });
  }

  textFiles.push(...footprintFiles);
  textFiles.push({ content: buildSymLibTable(libraryName, collectedSymbols.length > 0), path: "sym-lib-table" });
  textFiles.push({ content: buildFpLibTable(libraryName, footprintFiles.length > 0), path: "fp-lib-table" });
  textFiles.push({
    content: buildReadme({
      generatedAt: input.generatedAt ?? null,
      includedParts,
      libraryName,
      omittedParts,
      symbolCollisions
    }),
    path: "README.md"
  });

  // Stable output ordering keeps the emitted tree reproducible regardless of insertion order.
  textFiles.sort((first, second) => first.path.localeCompare(second.path));
  modelRefs.sort((first, second) => first.path.localeCompare(second.path));

  return {
    includedParts,
    libraryName,
    modelRefs,
    omittedParts,
    symbolCollisions,
    textFiles
  };
}

/** CollectedSymbol holds a verbatim symbol form (already renamed) and its final name. */
interface CollectedSymbol {
  name: string;
  span: string;
}

/** ExtractedSymbol is one `(symbol ...)` form parsed out of a source library. */
interface ExtractedSymbol {
  name: string;
  /** Verbatim source text of the whole `(symbol ...)` form. */
  span: string;
  /** Offset of the name token within {@link span}, for deterministic renaming. */
  nameStartInSpan: number;
  nameEndInSpan: number;
}

/**
 * Reads an asset's text content, treating empty/whitespace-only content as absent.
 */
function readAssetContent(asset: KicadEmissionAssetInput | null | undefined): string | null {
  const content = asset?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }
  return content;
}

/**
 * Orders parts deterministically by mpn then partId so emission is reproducible.
 */
function comparePartsForEmission(first: KicadEmissionPart, second: KicadEmissionPart): number {
  const byMpn = first.mpn.localeCompare(second.mpn);
  return byMpn !== 0 ? byMpn : first.partId.localeCompare(second.partId);
}

/**
 * Sanitizes an arbitrary string into a KiCad-safe identifier (library nickname / file stem).
 * KiCad nicknames and file stems should avoid spaces and most punctuation; we keep word characters,
 * dots, and dashes and collapse everything else to underscores.
 */
export function sanitizeKicadIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

/**
 * Sanitizes a 3D model file name, preserving a known model extension when present.
 */
function sanitizeModelFileName(fileName: string | undefined, mpn: string, partId: string): string {
  const fallbackStem = sanitizeKicadIdentifier(mpn) || partId;
  if (!fileName) {
    return `${fallbackStem}.step`;
  }
  const match = /\.([A-Za-z0-9]+)$/u.exec(fileName.trim());
  const extension = match ? match[1]!.toLowerCase() : "step";
  const stem = sanitizeKicadIdentifier(fileName.slice(0, match ? fileName.length - match[0].length : fileName.length)) || fallbackStem;
  return `${stem}.${extension}`;
}

/**
 * Returns a name unique within the supplied set by appending `_2`, `_3`, … on collision.
 */
function ensureUniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    return name;
  }
  let suffix = 2;
  while (used.has(`${name}_${suffix}`)) {
    suffix += 1;
  }
  return `${name}_${suffix}`;
}

/**
 * Returns a file stem unique within the supplied set by appending `_2`, `_3`, … on collision.
 */
function ensureUniqueFileStem(stem: string, used: Set<string>): string {
  return ensureUniqueName(stem, used);
}

/**
 * Ensures text ends with exactly one trailing newline so concatenated/emitted files stay tidy.
 */
function ensureTrailingNewline(text: string): string {
  return `${text.replace(/\s+$/u, "")}\n`;
}

// ---------------------------------------------------------------------------
// S-expression scanning (string-aware) for symbol extraction and merging.
// ---------------------------------------------------------------------------

/**
 * Extracts the top-level `(symbol ...)` forms from a `.kicad_sym` library.
 *
 * Handles both the normal `(kicad_symbol_lib (symbol ...)(symbol ...))` wrapper and a bare
 * `(symbol ...)` root. Symbol forms nested inside another symbol (KiCad sub-units) are NOT extracted
 * — only direct children of the root are, which is what defines a library entry.
 */
export function extractSymbolsFromLibrary(libraryText: string): ExtractedSymbol[] {
  const root = parseFirstForm(libraryText);
  if (!root) {
    return [];
  }

  const rootHead = root.head;
  const symbolNodes: SExprList[] =
    rootHead === "symbol"
      ? [root]
      : root.children.filter((child): child is SExprList => isList(child) && child.head === "symbol");

  const extracted: ExtractedSymbol[] = [];
  for (const node of symbolNodes) {
    const nameToken = node.children[1];
    if (!nameToken || isList(nameToken)) {
      // A symbol with no name token is malformed for our purposes; skip it rather than emit junk.
      continue;
    }
    const span = libraryText.slice(node.start, node.end);
    extracted.push({
      name: nameToken.value,
      nameEndInSpan: nameToken.end - node.start,
      nameStartInSpan: nameToken.start - node.start,
      span
    });
  }
  return extracted;
}

/**
 * Rewrites the name token inside a verbatim symbol span, returning the renamed span. Used to
 * deterministically resolve symbol-name collisions across parts without reformatting the symbol body.
 */
function renameSymbolSpan(symbol: ExtractedSymbol, newName: string): string {
  if (newName === symbol.name) {
    return symbol.span;
  }
  const before = symbol.span.slice(0, symbol.nameStartInSpan);
  const after = symbol.span.slice(symbol.nameEndInSpan);
  return `${before}${quoteKicadString(newName)}${after}`;
}

/**
 * Reads the `(version ...)` declared on the first part's symbol library, if any, so the merged
 * library keeps a version compatible with its symbol bodies.
 */
function readFirstDeclaredSymbolLibVersion(parts: KicadEmissionPart[]): string | null {
  for (const part of parts) {
    const text = readAssetContent(part.symbol);
    if (!text) {
      continue;
    }
    const root = parseFirstForm(text);
    if (!root || root.head !== "kicad_symbol_lib") {
      continue;
    }
    for (const child of root.children) {
      if (isList(child) && child.head === "version") {
        const token = child.children[1];
        if (token && !isList(token)) {
          return token.value;
        }
      }
    }
  }
  return null;
}

/**
 * Builds the merged `(kicad_symbol_lib ...)` text from collected symbol spans.
 */
function buildMergedSymbolLibrary(symbols: CollectedSymbol[], version: string): string {
  const header = `(kicad_symbol_lib (version ${version}) (generator ${KICAD_LIBRARY_GENERATOR})`;
  const body = symbols.map((symbol) => indentSpan(symbol.span)).join("\n");
  return `${header}\n${body}\n)\n`;
}

/**
 * Indents a verbatim symbol span by two spaces on each line so the merged library reads cleanly.
 */
function indentSpan(span: string): string {
  return span
    .split("\n")
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}

/** SExprToken is an atom or quoted string with source offsets. */
interface SExprToken {
  value: string;
  quoted: boolean;
  start: number;
  end: number;
}

/** SExprList is a parenthesized form with source offsets and a convenience head atom. */
interface SExprList {
  children: SExprNode[];
  head: string | null;
  start: number;
  end: number;
}

type SExprNode = SExprList | SExprToken;

/** Narrows an S-expression node to a list. */
function isList(node: SExprNode): node is SExprList {
  return (node as SExprList).children !== undefined;
}

/**
 * Parses the first complete parenthesized form in the text, returning it with source offsets, or
 * null when none is present. String-aware: parentheses inside double-quoted tokens are ignored, and
 * `\"` / `\\` escapes are handled.
 */
export function parseFirstForm(text: string): SExprList | null {
  let index = 0;
  while (index < text.length && text[index] !== "(") {
    index += 1;
  }
  if (index >= text.length) {
    return null;
  }
  const [node] = parseList(text, index);
  return node;
}

/**
 * Parses a parenthesized list beginning at `text[open] === "("`. Returns the list and the index just
 * past its closing `)`.
 */
function parseList(text: string, open: number): [SExprList, number] {
  const children: SExprNode[] = [];
  let index = open + 1;

  while (index < text.length) {
    const char = text[index]!;

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === ")") {
      index += 1;
      break;
    }
    if (char === "(") {
      const [child, next] = parseList(text, index);
      children.push(child);
      index = next;
      continue;
    }
    if (char === '"') {
      const [token, next] = parseQuotedToken(text, index);
      children.push(token);
      index = next;
      continue;
    }
    const [token, next] = parseAtomToken(text, index);
    children.push(token);
    index = next;
  }

  const first = children[0];
  const head = first && !isList(first) ? first.value : null;
  return [{ children, end: index, head, start: open }, index];
}

/**
 * Parses a double-quoted token starting at `text[open] === '"'`, honoring `\"` and `\\` escapes.
 */
function parseQuotedToken(text: string, open: number): [SExprToken, number] {
  let index = open + 1;
  let value = "";
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\" && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
      continue;
    }
    if (char === '"') {
      index += 1;
      break;
    }
    value += char;
    index += 1;
  }
  return [{ end: index, quoted: true, start: open, value }, index];
}

/**
 * Parses a bare atom token (terminated by whitespace, parens, or a quote).
 */
function parseAtomToken(text: string, open: number): [SExprToken, number] {
  let index = open;
  while (index < text.length) {
    const char = text[index]!;
    if (isWhitespace(char) || char === "(" || char === ")" || char === '"') {
      break;
    }
    index += 1;
  }
  return [{ end: index, quoted: false, start: open, value: text.slice(open, index) }, index];
}

/** Returns whether a character is S-expression whitespace. */
function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/**
 * Quotes a string the way KiCad expects (double quotes with backslash escaping).
 */
function quoteKicadString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Library tables and README.
// ---------------------------------------------------------------------------

/**
 * Builds a `sym-lib-table` registering the emitted symbol library relative to the project dir.
 */
export function buildSymLibTable(libraryName: string, hasSymbols: boolean): string {
  if (!hasSymbols) {
    return "(sym_lib_table\n  (version 7)\n)\n";
  }
  const uri = `\${KIPRJMOD}/symbols/${libraryName}.kicad_sym`;
  return [
    "(sym_lib_table",
    "  (version 7)",
    `  (lib (name "${libraryName}")(type "KiCad")(uri "${uri}")(options "")(descr "EE Library export: verified symbols"))`,
    ")",
    ""
  ].join("\n");
}

/**
 * Builds an `fp-lib-table` registering the emitted footprint library relative to the project dir.
 */
export function buildFpLibTable(libraryName: string, hasFootprints: boolean): string {
  if (!hasFootprints) {
    return "(fp_lib_table\n  (version 7)\n)\n";
  }
  const uri = `\${KIPRJMOD}/footprints/${libraryName}.pretty`;
  return [
    "(fp_lib_table",
    "  (version 7)",
    `  (lib (name "${libraryName}")(type "KiCad")(uri "${uri}")(options "")(descr "EE Library export: verified footprints"))`,
    ")",
    ""
  ].join("\n");
}

/** ReadmeInput is the provenance context rendered into README.md. */
interface ReadmeInput {
  libraryName: string;
  generatedAt: string | null;
  includedParts: KicadIncludedPart[];
  omittedParts: KicadOmittedPart[];
  symbolCollisions: KicadSymbolCollision[];
}

/**
 * Builds a provenance README documenting what was packaged, what was omitted, and the honesty
 * boundaries of the export. Deterministic given deterministic input (including `generatedAt`).
 */
export function buildReadme(input: ReadmeInput): string {
  const lines: string[] = [];
  lines.push(`# KiCad library: ${input.libraryName}`, "");
  lines.push(
    "Generated by EE Library. This library **packages verified, file-backed CAD assets** from your",
    "engineering memory into a drop-in KiCad library. It does not generate symbols or footprints from",
    "metadata — every file here came from an asset that was verified for export.",
    ""
  );
  if (input.generatedAt) {
    lines.push(`Generated at: ${input.generatedAt}`, "");
  }
  lines.push("## How to use", "");
  lines.push(
    "Copy this folder into your KiCad project, or merge `sym-lib-table` and `fp-lib-table` into your",
    "project tables. The library paths are relative to `${KIPRJMOD}` (the project directory).",
    ""
  );

  lines.push("## Included parts", "");
  if (input.includedParts.length === 0) {
    lines.push("_No parts had verified file-backed KiCad assets to export._", "");
  } else {
    lines.push("| MPN | Symbols | Footprint | 3D model |", "| --- | --- | --- | --- |");
    for (const part of input.includedParts) {
      const symbols = part.symbolNames.length > 0 ? part.symbolNames.join(", ") : "—";
      lines.push(`| ${part.mpn} | ${symbols} | ${part.footprintFile ?? "—"} | ${part.modelFile ?? "—"} |`);
    }
    lines.push("");
  }

  if (input.symbolCollisions.length > 0) {
    lines.push("## Renamed symbols", "");
    lines.push(
      "Some symbol names collided across parts and were renamed to keep the merged library unambiguous:",
      ""
    );
    for (const collision of input.symbolCollisions) {
      lines.push(`- \`${collision.originalName}\` → \`${collision.renamedTo}\` (part ${collision.partId})`);
    }
    lines.push("");
  }

  if (input.omittedParts.length > 0) {
    lines.push("## Omitted parts", "");
    lines.push("These parts are in the selection but contributed no files to this library:", "");
    for (const part of input.omittedParts) {
      lines.push(`- **${part.mpn}** (${part.partId}): ${part.reason}`);
    }
    lines.push("");
  }

  lines.push("## Limitations", "");
  lines.push(
    "- 3D model references inside footprints are **not** rewritten; if a footprint points at a 3D",
    "  model path, adjust it to your local `3dmodels/` location as needed.",
    "- Only assets verified for export are included. Parts missing trusted CAD are listed above as omitted."
  );

  return `${lines.join("\n")}\n`;
}
