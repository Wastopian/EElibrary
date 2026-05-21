/**
 * File header: Parses and maps CSV and XLSX BOM files for project-memory preview and persistence.
 */

import * as XLSX from "xlsx";
import type { BomColumnMapping, BomImportPreviewInput, BomImportPreviewResponse, BomImportPreviewRow } from "./types";

/** BomCsvErrorCode names parser failures that API and UI callers can show clearly. */
export type BomCsvErrorCode = "EMPTY_FILE" | "UNTERMINATED_QUOTE" | "HEADER_REQUIRED" | "ROW_LIMIT_EXCEEDED" | "UNSUPPORTED_FORMAT";

/** BomCsvParseOptions controls bounded parsing for preview and API persistence. */
export interface BomCsvParseOptions {
  /** Maximum nonblank data rows allowed in one import. */
  maxRows?: number;
  /** Maximum parsed rows returned in preview responses. */
  previewRowLimit?: number;
}

/** ParsedBomCsv carries all parsed rows for persistence plus bounded preview metadata. */
export interface ParsedBomCsv {
  headers: string[];
  rows: BomImportPreviewRow[];
  rowCount: number;
  skippedBlankRowCount: number;
  warnings: string[];
}

/** BomLineDraft is the canonical mapped shape before the API assigns ids and timestamps. */
export interface BomLineDraft {
  rowNumber: number;
  designators: string[];
  quantity: number | null;
  rawMpn: string | null;
  rawManufacturer: string | null;
  rawDescription: string | null;
  rawSupplierReference: string | null;
  rawNotes: string | null;
  rawRowPayload: Record<string, string>;
}

/** BomCsvParseError carries a stable error code for API responses. */
export class BomCsvParseError extends Error {
  readonly code: BomCsvErrorCode;

  /**
   * Creates a CSV parsing error with a machine-readable code.
   */
  constructor(code: BomCsvErrorCode, message: string) {
    super(message);
    this.name = "BomCsvParseError";
    this.code = code;
  }
}

const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_PREVIEW_ROW_LIMIT = 20;

/**
 * Builds a no-write preview response from raw file content. CSV is plain text; XLSX is base64.
 */
export function buildBomImportPreview(input: BomImportPreviewInput, options: BomCsvParseOptions = {}): BomImportPreviewResponse {
  const parsed = input.sourceFormat === "xlsx"
    ? parseBomXlsx(input.rawContent, options)
    : parseBomCsv(input.rawContent, options);
  const previewLimit = options.previewRowLimit ?? DEFAULT_PREVIEW_ROW_LIMIT;

  return {
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    rowsPreview: parsed.rows.slice(0, previewLimit),
    skippedBlankRowCount: parsed.skippedBlankRowCount,
    sourceFilename: input.sourceFilename,
    sourceFormat: input.sourceFormat,
    suggestedMapping: suggestBomColumnMapping(parsed.headers),
    warnings: parsed.warnings
  };
}

/**
 * Parses a base64-encoded XLSX workbook into the same row shape as parseBomCsv.
 * Uses the first worksheet in the workbook.
 */
export function parseBomXlsx(base64Content: string, options: BomCsvParseOptions = {}): ParsedBomCsv {
  const workbook = XLSX.read(base64Content, { type: "base64" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new BomCsvParseError("EMPTY_FILE", "The XLSX workbook contains no worksheets.");
  }

  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new BomCsvParseError("EMPTY_FILE", "The first XLSX worksheet is empty.");
  }

  const table: string[][] = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, defval: "" });

  if (table.length === 0 || !table[0] || table[0].every((cell) => String(cell).trim().length === 0)) {
    throw new BomCsvParseError("HEADER_REQUIRED", "The XLSX worksheet needs a header row.");
  }

  const headers = makeUniqueHeaders(table[0].map(String));
  const rows: BomImportPreviewRow[] = [];
  let skippedBlankRowCount = 0;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  for (let index = 1; index < table.length; index += 1) {
    const record = (table[index] ?? []).map(String);

    if (record.every((cell) => cell.trim().length === 0)) {
      skippedBlankRowCount += 1;
      continue;
    }

    if (rows.length >= maxRows) {
      throw new BomCsvParseError("ROW_LIMIT_EXCEEDED", `BOM XLSX imports are limited to ${maxRows} nonblank rows.`);
    }

    rows.push({
      rowNumber: rows.length + 1,
      values: rowToRecord(headers, record)
    });
  }

  if (rows.length === 0) {
    throw new BomCsvParseError("EMPTY_FILE", "No nonblank rows were found in the XLSX worksheet.");
  }

  return {
    headers,
    rowCount: rows.length,
    rows,
    skippedBlankRowCount,
    warnings: buildCsvWarnings(headers, rows, skippedBlankRowCount)
  };
}

/**
 * Parses CSV text into unique headers and raw row objects while preserving row order.
 */
export function parseBomCsv(rawContent: string, options: BomCsvParseOptions = {}): ParsedBomCsv {
  const trimmedContent = rawContent.replace(/^\uFEFF/u, "");

  if (trimmedContent.trim().length === 0) {
    throw new BomCsvParseError("EMPTY_FILE", "The BOM CSV file is empty.");
  }

  const table = parseCsvTable(trimmedContent);

  if (table.length === 0 || !table[0] || isBlankCsvRecord(table[0])) {
    throw new BomCsvParseError("HEADER_REQUIRED", "The BOM CSV file needs a header row.");
  }

  const headers = makeUniqueHeaders(table[0]);
  const rows: BomImportPreviewRow[] = [];
  let skippedBlankRowCount = 0;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  for (let index = 1; index < table.length; index += 1) {
    const record = table[index] ?? [];

    if (isBlankCsvRecord(record)) {
      skippedBlankRowCount += 1;
      continue;
    }

    if (rows.length >= maxRows) {
      throw new BomCsvParseError("ROW_LIMIT_EXCEEDED", `BOM CSV imports are limited to ${maxRows} nonblank rows.`);
    }

    rows.push({
      rowNumber: rows.length + 1,
      values: rowToRecord(headers, record)
    });
  }

  return {
    headers,
    rowCount: rows.length,
    rows,
    skippedBlankRowCount,
    warnings: buildCsvWarnings(headers, rows, skippedBlankRowCount)
  };
}

/**
 * Maps parsed CSV rows into canonical BOM line drafts.
 */
export function mapBomRowsToDrafts(rows: BomImportPreviewRow[], mapping: BomColumnMapping): BomLineDraft[] {
  return rows.map((row) => ({
    designators: parseDesignators(readMappedValue(row, mapping.designators)),
    quantity: parseQuantity(readMappedValue(row, mapping.quantity)),
    rawDescription: normalizeNullableText(readMappedValue(row, mapping.description)),
    rawManufacturer: normalizeNullableText(readMappedValue(row, mapping.manufacturer)),
    rawMpn: normalizeNullableText(readMappedValue(row, mapping.mpn)),
    rawNotes: normalizeNullableText(readMappedValue(row, mapping.notes)),
    rawRowPayload: row.values,
    rawSupplierReference: normalizeNullableText(readMappedValue(row, mapping.supplierReference)),
    rowNumber: row.rowNumber
  }));
}

/**
 * Suggests canonical field mappings from common BOM header names.
 */
export function suggestBomColumnMapping(headers: string[]): BomColumnMapping {
  return {
    description: findHeader(headers, ["description", "desc", "part description", "item description"]),
    designators: findHeader(headers, ["designator", "designators", "refdes", "reference", "references", "reference designator", "reference designators"]),
    manufacturer: findHeader(headers, ["manufacturer", "mfg", "mfr", "maker", "manufacturer name"]),
    mpn: findHeader(headers, ["mpn", "manufacturer part number", "mfg part number", "mfr part number", "part number", "part no", "part"]),
    notes: findHeader(headers, ["notes", "note", "comment", "comments"]),
    quantity: findHeader(headers, ["qty", "quantity", "count"]),
    supplierReference: findHeader(headers, [
      "supplier",
      "supplier part",
      "supplier part number",
      "supplier pn",
      "supplier url",
      "supplier link",
      "product url",
      "purchase link",
      "link",
      "url",
      "digikey",
      "mouser",
      "lcsc",
      "jlcpcb",
      "provider part"
    ])
  };
}

/**
 * Counts how many mapping fields point at a real source header.
 */
export function countMappedBomFields(mapping: BomColumnMapping): number {
  return Object.values(mapping).filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

/**
 * Checks that a required mapping header exists in the parsed file.
 */
export function hasMappedHeader(headers: string[], headerName: string | null | undefined): boolean {
  return typeof headerName === "string" && headers.includes(headerName);
}

/**
 * Parses a CSV table with quoted fields, escaped quotes, and CRLF line endings.
 */
function parseCsvTable(rawContent: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < rawContent.length; index += 1) {
    const char = rawContent[index];
    const nextChar = rawContent[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";

      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      continue;
    }

    currentField += char;
  }

  if (inQuotes) {
    throw new BomCsvParseError("UNTERMINATED_QUOTE", "The BOM CSV file has an unterminated quoted field.");
  }

  currentRow.push(currentField);
  rows.push(currentRow);

  return rows.filter((row, index) => index < rows.length - 1 || !isBlankCsvRecord(row));
}

/**
 * Converts a CSV row into a record keyed by the unique header labels.
 */
function rowToRecord(headers: string[], row: string[]): Record<string, string> {
  return headers.reduce<Record<string, string>>((record, header, index) => {
    record[header] = normalizeCsvCell(row[index] ?? "");
    return record;
  }, {});
}

/**
 * Builds unique, nonempty header labels while keeping human-readable source names.
 */
function makeUniqueHeaders(rawHeaders: string[]): string[] {
  const seen = new Map<string, number>();

  return rawHeaders.map((header, index) => {
    const trimmedHeader = normalizeCsvCell(header);
    const baseHeader = trimmedHeader.length > 0 ? trimmedHeader : `Column ${index + 1}`;
    const seenCount = seen.get(baseHeader) ?? 0;
    seen.set(baseHeader, seenCount + 1);

    return seenCount === 0 ? baseHeader : `${baseHeader} (${seenCount + 1})`;
  });
}

/**
 * Builds nonblocking parser warnings for operator visibility.
 */
function buildCsvWarnings(headers: string[], rows: BomImportPreviewRow[], skippedBlankRowCount: number): string[] {
  const warnings: string[] = [];

  if (skippedBlankRowCount > 0) {
    warnings.push(`${skippedBlankRowCount} blank row${skippedBlankRowCount === 1 ? "" : "s"} skipped.`);
  }

  if (!hasMappedHeader(headers, suggestBomColumnMapping(headers).mpn)) {
    warnings.push("No obvious MPN column was detected; map it before saving the BOM.");
  }

  if (rows.length === 0) {
    warnings.push("No nonblank BOM rows were found after the header.");
  }

  return warnings;
}

/**
 * Checks whether every field in a CSV record is blank.
 */
function isBlankCsvRecord(record: string[]): boolean {
  return record.every((field) => normalizeCsvCell(field).length === 0);
}

/**
 * Normalizes one CSV cell without hiding interior whitespace.
 */
function normalizeCsvCell(value: string): string {
  return value.replace(/\u0000/gu, "").trim();
}

/**
 * Finds the first header that matches a known normalized alias.
 */
function findHeader(headers: string[], aliases: string[]): string | null {
  const normalizedAliases = new Set(aliases.map(normalizeHeaderForMatching));

  return headers.find((header) => normalizedAliases.has(normalizeHeaderForMatching(header))) ?? null;
}

/**
 * Normalizes header labels for alias matching.
 */
function normalizeHeaderForMatching(value: string): string {
  return value.toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * Reads a mapped row value by source header name.
 */
function readMappedValue(row: BomImportPreviewRow, headerName: string | null | undefined): string | null {
  if (!headerName) {
    return null;
  }

  return row.values[headerName] ?? null;
}

/**
 * Converts optional text into null when the source cell is blank.
 */
function normalizeNullableText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

/**
 * Parses comma, semicolon, and whitespace-separated designators without expanding ranges.
 */
function parseDesignators(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(new Set(value.split(/[,;\s]+/u).map((item) => item.trim()).filter((item) => item.length > 0)));
}

/**
 * Parses numeric quantities while leaving invalid or blank quantities unknown.
 */
function parseQuantity(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalizedValue = value.replace(/,/gu, "").trim();
  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}
