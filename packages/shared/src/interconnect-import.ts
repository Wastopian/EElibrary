/**
 * File header: Parses and maps cable pin-map CSV/XLSX files into pin-row inputs.
 *
 * Reuses the generic tabular parsers from bom-csv.ts. The mapping and heuristics here are
 * interconnect-specific (connector ref, pin, signal, wire, destination). Imported rows are
 * recorded memory only — this module never approves a part or unlocks export.
 */

import { parseBomCsv, parseBomXlsx } from "./bom-csv";
import type {
  BomImportPreviewRow,
  CableAssemblyEndLabel,
  CablePinMapRowInput,
  PinMapColumnMapping,
  PinMapImportConfirmInput,
  PinMapImportPreviewInput,
  PinMapImportPreviewResponse
} from "./types";

const PREVIEW_ROW_LIMIT = 20;
const END_LABELS: CableAssemblyEndLabel[] = ["A", "B", "C", "D", "other"];

/**
 * Parses an uploaded pin-map file and returns headers, a bounded row preview, and a suggested mapping.
 */
export function buildPinMapImportPreview(input: PinMapImportPreviewInput): PinMapImportPreviewResponse {
  const parsed = input.sourceFormat === "xlsx" ? parseBomXlsx(input.rawContent) : parseBomCsv(input.rawContent);

  return {
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    rowsPreview: parsed.rows.slice(0, PREVIEW_ROW_LIMIT),
    sourceFilename: input.sourceFilename,
    sourceFormat: input.sourceFormat,
    suggestedMapping: suggestPinMapColumnMapping(parsed.headers),
    warnings: parsed.warnings
  };
}

/**
 * Suggests a column mapping from header names. Destination-side columns ("to"/"dest") are matched
 * separately so a "To Pin" header maps to the destination pin, not the source pin.
 */
export function suggestPinMapColumnMapping(headers: string[]): PinMapColumnMapping {
  const isDestination = (header: string): boolean => /(^|\b)(to|dest|destination)\b/u.test(header.toLowerCase());
  const findSource = (pattern: RegExp): string | null =>
    headers.find((header) => pattern.test(header.toLowerCase()) && !isDestination(header)) ?? null;
  const findDestination = (pattern: RegExp): string | null =>
    headers.find((header) => pattern.test(header.toLowerCase()) && isDestination(header)) ?? null;
  const findAny = (pattern: RegExp): string | null => headers.find((header) => pattern.test(header.toLowerCase())) ?? null;

  return {
    connectorRef: findSource(/conn(ector)?\b|connector ref/u),
    destinationConnectorRef: findDestination(/conn(ector)?\b/u),
    destinationPinNumber: findDestination(/\bpin\b/u),
    endLabel: findAny(/^end\b|cable end/u),
    pinNumber: findSource(/\bpin\b/u),
    signalName: findAny(/signal|\bnet\b|function/u),
    wireColor: findAny(/colou?r/u),
    wireGauge: findAny(/awg|gauge|gage/u)
  };
}

/**
 * Parses an uploaded pin-map file in full (all rows, not just the preview slice) and maps every row
 * to a pin-row input. Used by the confirm path so the whole file is imported, not just the preview.
 */
export function parsePinMapFileToInputs(input: PinMapImportConfirmInput): CablePinMapRowInput[] {
  const parsed = input.sourceFormat === "xlsx" ? parseBomXlsx(input.rawContent) : parseBomCsv(input.rawContent);
  return mapPinMapRowsToInputs(parsed.rows, input.columnMapping);
}

/**
 * Turns parsed rows into pin-row inputs using the chosen mapping. Required fields left blank stay
 * blank so the API's per-row validator can reject them as invalid (rather than guessing values).
 */
export function mapPinMapRowsToInputs(rows: BomImportPreviewRow[], mapping: PinMapColumnMapping): CablePinMapRowInput[] {
  const value = (row: BomImportPreviewRow, header: string | null): string => (header ? (row.values[header] ?? "").trim() : "");

  return rows.map((row) => {
    const endRaw = value(row, mapping.endLabel).toUpperCase();
    const endLower = endRaw.toLowerCase();
    const endLabel: CableAssemblyEndLabel = (END_LABELS as string[]).includes(endRaw)
      ? (endRaw as CableAssemblyEndLabel)
      : endLower === "other"
        ? "other"
        : "A";

    const gaugeDigits = value(row, mapping.wireGauge).replace(/[^0-9]/gu, "");
    const gauge = gaugeDigits.length > 0 ? Number.parseInt(gaugeDigits, 10) : null;

    return {
      connectorRef: value(row, mapping.connectorRef),
      destinationConnectorRef: value(row, mapping.destinationConnectorRef) || null,
      destinationPinNumber: value(row, mapping.destinationPinNumber) || null,
      endLabel,
      pinNumber: value(row, mapping.pinNumber),
      signalName: value(row, mapping.signalName),
      wireColor: value(row, mapping.wireColor) || null,
      wireGauge: gauge !== null && Number.isFinite(gauge) && gauge > 0 ? gauge : null
    };
  });
}
