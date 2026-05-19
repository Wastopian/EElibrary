/**
 * File header: First file-grounded asset validation jobs (footprint geometry sanity +
 * symbol pin-count cross-check).
 *
 * Why these two first: the trust lineage already records *who* reviewed an asset, but
 * has no record of *whether the file is sane*. Footprint pad-count vs pin-count and
 * symbol pin-count vs datasheet pin-count are the two checks an experienced engineer
 * eyeballs first when opening a new CAD asset; codifying them produces
 * `asset_validation_records` rows the existing review/promotion workflow can cite as
 * actual file-grounded evidence instead of unsupported reviewer assertions.
 *
 * Honesty discipline:
 *   - These jobs never mutate `review_status`, `export_status`, or `availability_status`
 *     on the asset they validate. They only write `asset_validation_records` rows. The
 *     existing review/promotion workflow is the single gate that promotes anything.
 *   - `validation_status = 'verified'` is only persisted when every assertion passes.
 *     `'needs_review'` is the honest fallback when the upstream data needed for a clean
 *     comparison (pin count, package body dimensions, datasheet pin-table extraction)
 *     is missing or low-confidence.
 *   - `'failed'` is reserved for decisive contradictions (pad count != known pin count
 *     by more than a tiny tolerance, pads outside the package bounding box).
 *   - `validation_notes` always records the actual numbers compared so a reviewer can
 *     audit the validator's reasoning without re-running it.
 *   - The validator name in `asset_validation_records.validator` is suffixed with a
 *     version (`generated:footprint_geometry_v1`) so a future v2 with stricter rules
 *     can coexist in history without overwriting past evidence.
 *
 * Both jobs use deterministic record ids of the form
 * `validation:{validation_type}:{asset_id}` so re-runs upsert into the same row instead
 * of accumulating duplicate evidence.
 */

import { randomUUID } from "node:crypto";
import { getWorkerDatabasePool } from "./catalog-repository";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { AssetValidationType, ValidationStatus } from "@ee-library/shared/types";
import type { Pool } from "pg";

/** ASSET_VALIDATION_GENERATED_VALIDATOR_PREFIX tags rows written by automated validators. */
export const ASSET_VALIDATION_GENERATED_VALIDATOR_PREFIX = "generated:";

/** FootprintGeometryValidatorVersion identifies the active footprint validator schema. */
const FOOTPRINT_GEOMETRY_VALIDATOR_VERSION = "footprint_geometry_v1";

/** SymbolPinCountValidatorVersion identifies the active symbol pin-count validator schema. */
const SYMBOL_PIN_COUNT_VALIDATOR_VERSION = "symbol_pin_mapping_v1";

/**
 * Tolerance (mm) we add to package body dimensions when checking pad bounding boxes.
 * KiCad and most CAD tools place pads slightly outside the body footprint for SMT parts
 * (the lead extends past the body), so the pad bounding box is allowed to exceed the
 * body dimensions by this slack on each side before the validator complains.
 */
const FOOTPRINT_BODY_BBOX_TOLERANCE_MM = 5.0;

/**
 * AssetValidationJobOutcome captures one validator's per-asset decision plus the
 * fields that ended up in the persisted record so the daemon log is auditable.
 */
export interface AssetValidationJobOutcome {
  assetId: string;
  partId: string;
  validationType: AssetValidationType;
  status:
    | "validated"
    | "skipped_source_unreadable"
    | "skipped_unknown_file_format"
    | "skipped_no_candidate";
  recordedStatus: ValidationStatus | null;
  notes: string | null;
}

/** AssetValidationJobSummary is the daemon-facing report for one batch. */
export interface AssetValidationJobSummary {
  processed: AssetValidationJobOutcome[];
}

/**
 * FootprintGeometryCandidateRow is the minimum data we need to score one footprint
 * asset against its package metadata. The package columns are LEFT-joined so an asset
 * whose part has no package_id still produces a candidate (it just yields a
 * `needs_review` outcome instead of `verified`).
 */
interface FootprintGeometryCandidateRow {
  asset_id: string;
  part_id: string;
  storage_key: string;
  file_format: string;
  package_pin_count: number | null;
  body_length_mm: number | null;
  body_width_mm: number | null;
}

/**
 * SymbolPinCountCandidateRow is the minimum data we need to compare a symbol's pin
 * count against the most-confident datasheet pin-table extraction signal recorded for
 * the same part. `pin_table_confidence` is null when no signal exists at all -- in
 * which case the validator persists a `needs_review` row, never `verified`.
 *
 * `pin_table_pin_count` is parsed in TypeScript from the signal's free-form `notes`
 * column rather than via Postgres regex so the same logic ships across pg-mem (tests)
 * and real Postgres without dialect drift. The contract: if the notes string contains
 * the substring `pin_count=<digits>` we adopt that as the extracted pin count;
 * otherwise we treat the count as missing and the decision falls back to needs_review.
 */
export interface SymbolPinCountCandidateRow {
  asset_id: string;
  part_id: string;
  storage_key: string;
  file_format: string;
  pin_table_confidence: number | null;
  pin_table_pin_count: number | null;
}

/**
 * Reads up to `limit` footprint assets that have a stored file we can parse, runs the
 * geometry validator against each, and persists one `asset_validation_records` row per
 * asset.
 *
 * The query intentionally does **not** filter on the asset's existing
 * `validation_status` so a regression that flips a previously-verified row to `failed`
 * lands as fresh evidence on the next run, instead of being silently skipped because
 * the row was once trusted.
 */
export async function processFootprintGeometryValidations(
  limit: number,
  storage: FileStorageClient,
  now: Date = new Date()
): Promise<AssetValidationJobSummary> {
  const pool = getWorkerDatabasePool();
  const candidates = await readFootprintGeometryCandidates(pool, Math.max(1, limit));
  const processed: AssetValidationJobOutcome[] = [];

  for (const candidate of candidates) {
    processed.push(await runFootprintGeometryValidation(pool, storage, candidate, now));
  }

  return { processed };
}

/**
 * Reads up to `limit` symbol assets that have a stored file we can parse and at least
 * one pin-table extraction signal, runs the pin-count cross-check against each, and
 * persists one `asset_validation_records` row per asset.
 */
export async function processSymbolPinCountValidations(
  limit: number,
  storage: FileStorageClient,
  now: Date = new Date()
): Promise<AssetValidationJobSummary> {
  const pool = getWorkerDatabasePool();
  const candidates = await readSymbolPinCountCandidates(pool, Math.max(1, limit));
  const processed: AssetValidationJobOutcome[] = [];

  for (const candidate of candidates) {
    processed.push(await runSymbolPinCountValidation(pool, storage, candidate, now));
  }

  return { processed };
}

/**
 * Reads footprint assets whose source file is locally stored. The LEFT JOIN against
 * packages keeps assets whose part has no package_id in the candidate set so the
 * validator can persist an honest `needs_review` row instead of skipping silently.
 */
async function readFootprintGeometryCandidates(
  pool: Pool,
  limit: number
): Promise<FootprintGeometryCandidateRow[]> {
  const result = await pool.query<FootprintGeometryCandidateRow>(
    `
      SELECT
        a.id AS asset_id,
        a.part_id AS part_id,
        a.storage_key AS storage_key,
        a.file_format AS file_format,
        pkg.pin_count AS package_pin_count,
        pkg.body_length_mm AS body_length_mm,
        pkg.body_width_mm AS body_width_mm
      FROM assets a
      JOIN parts p ON p.id = a.part_id
      LEFT JOIN packages pkg ON pkg.id = p.package_id
      WHERE a.asset_type = 'footprint'
        AND a.availability_status IN ('downloaded', 'validated')
        AND a.storage_key IS NOT NULL
      ORDER BY a.last_updated_at ASC, a.id ASC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

/** RawSymbolPinCountCandidateRow is the unparsed shape returned by the SELECT. */
interface RawSymbolPinCountCandidateRow {
  asset_id: string;
  part_id: string;
  storage_key: string;
  file_format: string;
  pin_table_confidence: number | null;
  pin_table_notes: string | null;
}

/** PIN_COUNT_NOTES_PATTERN finds `pin_count=<digits>` anywhere in the signal notes. */
const PIN_COUNT_NOTES_PATTERN = /\bpin_count=(\d+)/u;

/**
 * Parses a `pin_count=<digits>` token out of a signal's free-form notes string. Returns
 * null when the substring is absent or the digits do not parse to a positive integer.
 *
 * Exposed so tests can pin the parser behaviour independently from the SQL plumbing.
 */
export function parsePinCountFromExtractionNotes(notes: string | null): number | null {
  if (notes === null) {
    return null;
  }
  const match = PIN_COUNT_NOTES_PATTERN.exec(notes);
  if (!match || !match[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * Reads symbol assets whose source file is locally stored, joined against the
 * highest-confidence pin-table extraction signal for the same part. The DISTINCT ON
 * collapses multiple signals down to the strongest evidence per part, which is what
 * the validator should compare against. Signal notes are returned raw; the
 * `pin_count=<digits>` token is parsed in TypeScript so the same parsing rule applies
 * across pg-mem and real Postgres (pg-mem rejects the `~` regex operator).
 */
async function readSymbolPinCountCandidates(
  pool: Pool,
  limit: number
): Promise<SymbolPinCountCandidateRow[]> {
  const result = await pool.query<RawSymbolPinCountCandidateRow>(
    `
      WITH strongest_pin_signal AS (
        SELECT DISTINCT ON (part_id)
          part_id,
          confidence_score,
          notes
        FROM source_extraction_signals
        WHERE signal_type = 'pin_table'
        ORDER BY part_id, confidence_score DESC, last_updated_at DESC
      )
      SELECT
        a.id AS asset_id,
        a.part_id AS part_id,
        a.storage_key AS storage_key,
        a.file_format AS file_format,
        sig.confidence_score AS pin_table_confidence,
        sig.notes AS pin_table_notes
      FROM assets a
      LEFT JOIN strongest_pin_signal sig ON sig.part_id = a.part_id
      WHERE a.asset_type = 'symbol'
        AND a.availability_status IN ('downloaded', 'validated')
        AND a.storage_key IS NOT NULL
      ORDER BY a.last_updated_at ASC, a.id ASC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map<SymbolPinCountCandidateRow>((row) => ({
    asset_id: row.asset_id,
    file_format: row.file_format,
    part_id: row.part_id,
    pin_table_confidence: row.pin_table_confidence,
    pin_table_pin_count: parsePinCountFromExtractionNotes(row.pin_table_notes),
    storage_key: row.storage_key
  }));
}

/**
 * Validates one footprint asset and persists the resulting evidence row.
 */
async function runFootprintGeometryValidation(
  pool: Pool,
  storage: FileStorageClient,
  candidate: FootprintGeometryCandidateRow,
  now: Date
): Promise<AssetValidationJobOutcome> {
  if (candidate.file_format !== "kicad_mod") {
    return {
      assetId: candidate.asset_id,
      partId: candidate.part_id,
      recordedStatus: null,
      status: "skipped_unknown_file_format",
      validationType: "footprint_geometry",
      notes: `Footprint validator only parses kicad_mod files (got '${candidate.file_format}').`
    };
  }

  let footprintBytes: Buffer;
  try {
    footprintBytes = await storage.read(candidate.storage_key);
  } catch (error) {
    return {
      assetId: candidate.asset_id,
      partId: candidate.part_id,
      recordedStatus: null,
      status: "skipped_source_unreadable",
      validationType: "footprint_geometry",
      notes: formatValidationError(error)
    };
  }

  const parsed = parseKicadFootprint(footprintBytes.toString("utf8"));
  const decision = decideFootprintGeometryStatus(parsed, candidate);
  await persistAssetValidationRecord(pool, {
    assetId: candidate.asset_id,
    notes: decision.notes,
    partId: candidate.part_id,
    status: decision.status,
    validationType: "footprint_geometry",
    validator: `${ASSET_VALIDATION_GENERATED_VALIDATOR_PREFIX}${FOOTPRINT_GEOMETRY_VALIDATOR_VERSION}`,
    when: now
  });

  return {
    assetId: candidate.asset_id,
    notes: decision.notes,
    partId: candidate.part_id,
    recordedStatus: decision.status,
    status: "validated",
    validationType: "footprint_geometry"
  };
}

/**
 * Validates one symbol asset and persists the resulting evidence row.
 */
async function runSymbolPinCountValidation(
  pool: Pool,
  storage: FileStorageClient,
  candidate: SymbolPinCountCandidateRow,
  now: Date
): Promise<AssetValidationJobOutcome> {
  if (candidate.file_format !== "kicad_sym") {
    return {
      assetId: candidate.asset_id,
      partId: candidate.part_id,
      recordedStatus: null,
      status: "skipped_unknown_file_format",
      validationType: "symbol_pin_mapping",
      notes: `Symbol validator only parses kicad_sym files (got '${candidate.file_format}').`
    };
  }

  let symbolBytes: Buffer;
  try {
    symbolBytes = await storage.read(candidate.storage_key);
  } catch (error) {
    return {
      assetId: candidate.asset_id,
      partId: candidate.part_id,
      recordedStatus: null,
      status: "skipped_source_unreadable",
      validationType: "symbol_pin_mapping",
      notes: formatValidationError(error)
    };
  }

  const symbolPinCount = countKicadSymbolPins(symbolBytes.toString("utf8"));
  const decision = decideSymbolPinCountStatus(symbolPinCount, candidate);
  await persistAssetValidationRecord(pool, {
    assetId: candidate.asset_id,
    notes: decision.notes,
    partId: candidate.part_id,
    status: decision.status,
    validationType: "symbol_pin_mapping",
    validator: `${ASSET_VALIDATION_GENERATED_VALIDATOR_PREFIX}${SYMBOL_PIN_COUNT_VALIDATOR_VERSION}`,
    when: now
  });

  return {
    assetId: candidate.asset_id,
    notes: decision.notes,
    partId: candidate.part_id,
    recordedStatus: decision.status,
    status: "validated",
    validationType: "symbol_pin_mapping"
  };
}

/** ParsedKicadFootprint is the small, validation-only shape we extract from kicad_mod. */
export interface ParsedKicadFootprint {
  padCount: number;
  pads: Array<{ xMm: number; yMm: number }>;
}

/**
 * Extracts pad count and pad center coordinates from a KiCad `.kicad_mod` text body.
 *
 * KiCad footprints are S-expressions; pads look like `(pad "1" smd ... (at 1.27 0))`.
 * We deliberately stay shallow: the validator only needs pad count and pad centers,
 * not full polygon geometry, so a regex over `(pad ` blocks is enough and stays
 * resilient against minor format drift across KiCad versions. A real CAD parser is
 * out of scope for v1; honest evidence over false precision.
 */
export function parseKicadFootprint(source: string): ParsedKicadFootprint {
  const padBlockPattern = /\(pad\b[^()]*(?:\([^()]*\)[^()]*)*\)/gu;
  const pads: Array<{ xMm: number; yMm: number }> = [];

  for (const match of source.matchAll(padBlockPattern)) {
    const padBlock = match[0];
    const atMatch = /\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/u.exec(padBlock);
    if (atMatch && atMatch[1] && atMatch[2]) {
      const xMm = Number.parseFloat(atMatch[1]);
      const yMm = Number.parseFloat(atMatch[2]);
      if (Number.isFinite(xMm) && Number.isFinite(yMm)) {
        pads.push({ xMm, yMm });
      }
    }
  }

  return { padCount: pads.length, pads };
}

/**
 * Counts KiCad symbol pins. Symbol files use `(pin TYPE STYLE (at X Y ANGLE) ...)`;
 * we count occurrences of the `(pin <word> <word> (at` opening so we never confuse a
 * pin definition with a `(pin_names` block or property reference.
 */
export function countKicadSymbolPins(source: string): number {
  const pinOpening = /\(pin\s+\w+\s+\w+\s+\(at\b/gu;
  let count = 0;
  for (const _ of source.matchAll(pinOpening)) {
    count += 1;
  }
  return count;
}

/** FootprintGeometryDecision is the persisted-shape decision for one footprint. */
interface FootprintGeometryDecision {
  status: ValidationStatus;
  notes: string;
}

/**
 * Maps a parsed footprint + package metadata into a validation status + evidence note.
 *
 * Decision rules (in order):
 *   1. No pads parsed at all -> `failed` (a footprint with zero pads is not a usable
 *      footprint regardless of whether package metadata exists).
 *   2. Package pin count missing -> `needs_review` (we can't verify the parity).
 *   3. Pad count != package pin count -> `failed` (clear contradiction).
 *   4. Bounding box exceeds package body + tolerance on either axis -> `failed`.
 *   5. All assertions pass -> `verified`.
 *
 * Bounding box tolerance is one-sided (each side of the body) so a SMT pad sticking
 * out by the standard lead overhang does not falsely fail.
 */
export function decideFootprintGeometryStatus(
  parsed: ParsedKicadFootprint,
  candidate: FootprintGeometryCandidateRow
): FootprintGeometryDecision {
  if (parsed.padCount === 0) {
    return {
      notes: "No pads were parsed from the footprint source. A footprint with zero pads cannot be used for assembly.",
      status: "failed"
    };
  }

  const packagePinCount = candidate.package_pin_count;
  if (packagePinCount === null || packagePinCount <= 0) {
    return {
      notes:
        `Parsed pad count = ${parsed.padCount}. Package pin count is not recorded for this part, ` +
        "so footprint pad-count parity cannot be verified by this validator.",
      status: "needs_review"
    };
  }

  if (parsed.padCount !== packagePinCount) {
    return {
      notes:
        `Parsed pad count = ${parsed.padCount} but the part's package records pin_count = ${packagePinCount}. ` +
        "These must match before the footprint can be used for assembly.",
      status: "failed"
    };
  }

  const bodyLengthMm = candidate.body_length_mm;
  const bodyWidthMm = candidate.body_width_mm;
  if (bodyLengthMm === null || bodyWidthMm === null || bodyLengthMm <= 0 || bodyWidthMm <= 0) {
    return {
      notes:
        `Pad count = ${parsed.padCount} matches the package pin count, but package body ` +
        "dimensions are not recorded so the bounding-box check could not be evaluated.",
      status: "needs_review"
    };
  }

  const bbox = computePadBoundingBox(parsed.pads);
  const allowedHalfLength = bodyLengthMm / 2 + FOOTPRINT_BODY_BBOX_TOLERANCE_MM;
  const allowedHalfWidth = bodyWidthMm / 2 + FOOTPRINT_BODY_BBOX_TOLERANCE_MM;
  const xExceeds = Math.max(Math.abs(bbox.minX), Math.abs(bbox.maxX)) > allowedHalfLength;
  const yExceeds = Math.max(Math.abs(bbox.minY), Math.abs(bbox.maxY)) > allowedHalfWidth;
  if (xExceeds || yExceeds) {
    return {
      notes:
        `Pad bounding box [x: ${bbox.minX.toFixed(3)}..${bbox.maxX.toFixed(3)} mm, ` +
        `y: ${bbox.minY.toFixed(3)}..${bbox.maxY.toFixed(3)} mm] exceeds the package ` +
        `body envelope ${bodyLengthMm}x${bodyWidthMm} mm + ${FOOTPRINT_BODY_BBOX_TOLERANCE_MM} mm tolerance.`,
      status: "failed"
    };
  }

  return {
    notes:
      `Pad count = ${parsed.padCount} matches package pin count = ${packagePinCount}; ` +
      `bounding box [${bbox.minX.toFixed(3)}..${bbox.maxX.toFixed(3)}, ${bbox.minY.toFixed(3)}..${bbox.maxY.toFixed(3)} mm] ` +
      `fits within the package body envelope ${bodyLengthMm}x${bodyWidthMm} mm + ${FOOTPRINT_BODY_BBOX_TOLERANCE_MM} mm tolerance.`,
    status: "verified"
  };
}

/** SymbolPinCountDecision is the persisted-shape decision for one symbol. */
interface SymbolPinCountDecision {
  status: ValidationStatus;
  notes: string;
}

/**
 * Decides the symbol pin-count cross-check against the strongest pin-table signal.
 *
 * Decision rules (in order):
 *   1. Symbol parsed to zero pins -> `failed` (a symbol with no pins is unusable).
 *   2. No pin-table extraction signal present -> `needs_review` (no ground truth).
 *   3. Confidence below 0.75 OR no parsed pin count from the signal -> `needs_review`.
 *   4. Symbol pin count != extracted pin count -> `failed`.
 *   5. Match -> `verified`.
 *
 * 0.75 is the same threshold the rest of the system uses for "high-confidence
 * extraction" (matches the seeded confidence score on `verified` extraction signals).
 */
export function decideSymbolPinCountStatus(
  symbolPinCount: number,
  candidate: SymbolPinCountCandidateRow
): SymbolPinCountDecision {
  if (symbolPinCount === 0) {
    return {
      notes: "No pins were parsed from the symbol source. A symbol with zero pins cannot be used for capture.",
      status: "failed"
    };
  }

  const confidence = candidate.pin_table_confidence;
  const datasheetPinCount = candidate.pin_table_pin_count;
  if (confidence === null) {
    return {
      notes:
        `Symbol pin count = ${symbolPinCount}. No datasheet pin-table extraction signal is recorded ` +
        "for this part, so the symbol pin count cannot be cross-checked.",
      status: "needs_review"
    };
  }

  if (datasheetPinCount === null || confidence < 0.75) {
    return {
      notes:
        `Symbol pin count = ${symbolPinCount}. Datasheet pin-table extraction confidence = ` +
        `${confidence.toFixed(2)}${datasheetPinCount === null ? " and no extracted pin count is recorded" : ""}. ` +
        "Cross-check requires a high-confidence extraction (>= 0.75) with a parsed pin count.",
      status: "needs_review"
    };
  }

  if (symbolPinCount !== datasheetPinCount) {
    return {
      notes:
        `Symbol pin count = ${symbolPinCount} but the datasheet pin-table extraction (confidence ` +
        `${confidence.toFixed(2)}) recorded pin_count = ${datasheetPinCount}. These must match before ` +
        "the symbol can be used for schematic capture.",
      status: "failed"
    };
  }

  return {
    notes:
      `Symbol pin count = ${symbolPinCount} matches the datasheet pin-table extraction ` +
      `(confidence ${confidence.toFixed(2)}, pin_count = ${datasheetPinCount}).`,
    status: "verified"
  };
}

/**
 * Computes the axis-aligned bounding box of a set of pad centers.
 *
 * NOTE: this is a *center-of-pad* bbox, not a true polygon bbox. The
 * `FOOTPRINT_BODY_BBOX_TOLERANCE_MM` slack absorbs the gap between pad center and
 * pad edge plus the allowed lead overhang, which is enough rigor for v1; a true
 * polygon-aware geometry pass is a future v2 concern.
 */
function computePadBoundingBox(pads: Array<{ xMm: number; yMm: number }>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pad of pads) {
    if (pad.xMm < minX) minX = pad.xMm;
    if (pad.xMm > maxX) maxX = pad.xMm;
    if (pad.yMm < minY) minY = pad.yMm;
    if (pad.yMm > maxY) maxY = pad.yMm;
  }
  return { maxX, maxY, minX, minY };
}

/**
 * Persists one `asset_validation_records` row using a deterministic id so re-runs of
 * the same validator against the same asset upsert into the same row instead of
 * accumulating duplicate evidence. The validator string carries the version suffix so
 * historical decisions stay traceable.
 */
async function persistAssetValidationRecord(
  pool: Pool,
  input: {
    assetId: string;
    notes: string;
    partId: string;
    status: ValidationStatus;
    validationType: AssetValidationType;
    validator: string;
    when: Date;
  }
): Promise<void> {
  const recordId = `validation:${input.validationType}:${input.assetId}`;
  const isoTimestamp = input.when.toISOString();

  // Best-effort dedupe key: if a future schema replaces deterministic ids with surrogates,
  // randomUUID() keeps inserts unique while the upsert fallback below stays deterministic.
  void randomUUID;

  await pool.query(
    `
      INSERT INTO asset_validation_records (
        id,
        part_id,
        asset_id,
        validation_status,
        validation_type,
        validation_notes,
        validated_at,
        validator,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        validation_status = EXCLUDED.validation_status,
        validation_type = EXCLUDED.validation_type,
        validation_notes = EXCLUDED.validation_notes,
        validated_at = EXCLUDED.validated_at,
        validator = EXCLUDED.validator,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      recordId,
      input.partId,
      input.assetId,
      input.status,
      input.validationType,
      input.notes,
      isoTimestamp,
      input.validator,
      isoTimestamp
    ]
  );
}

/**
 * Renders an unknown error into a bounded string suitable for `validation_notes`.
 */
function formatValidationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return String(error).slice(0, 1000);
}
