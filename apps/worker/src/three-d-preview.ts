/**
 * File header: Generates derived 3D preview artifacts (glTF / glb) for stored STEP assets.
 *
 * Honesty discipline mirrors `export-bundle-assembly.ts`:
 *   - A STEP asset is only marked `preview_status = 'ready'` after a derived glTF/glb artifact
 *     has been written to a deterministic storage key. No converter configured ⇒ the row stays
 *     `pending` and the UI renders the "Preview generation queued" state.
 *   - The source STEP row's review / validation / export status is **never** touched by this
 *     job. Preview readiness is a rendering concern; it does not promote the underlying CAD
 *     bytes through the trust pipeline.
 *   - Conversion failures persist as bounded telemetry on the worker summary so an operator can
 *     see exactly which asset failed and why instead of a silent no-op.
 *
 * The actual STEP→glTF conversion is delegated through a swappable `ThreeDPreviewConverter`
 * interface so the worker can run in three modes:
 *   1. **Native converter configured** (CLI binary or library bound via env / setter) — converts
 *      and writes the derived bytes. This is the production path.
 *   2. **Source already embeddable** — when an upstream provider supplies a glb/gltf directly
 *      the converter is not invoked; the artifact channel mirrors the source storage key with
 *      `previewArtifactSource = 'source_native'`. (This branch is handled by the worker
 *      `withCanonicalAssetTruth` defaults at insert time, not this job.)
 *   3. **No converter** — the job leaves the asset alone with a `skipped_converter_unavailable`
 *      result so the daemon does not advertise rendering bytes that cannot be produced.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkerDatabasePool } from "./catalog-repository";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Asset, AssetPreviewArtifactFormat } from "@ee-library/shared/types";
import type { Pool } from "pg";

/**
 * Builds the deterministic storage key for one part's derived 3D preview artifact.
 *
 * Kept beside the source key so an operator browsing the storage tree sees the source STEP and
 * its preview artifact in the same directory; the format suffix avoids ambiguity when both glb
 * and gltf may be produced over time.
 */
export function buildThreeDPreviewArtifactStorageKey(
  partId: string,
  assetId: string,
  format: Extract<AssetPreviewArtifactFormat, "glb" | "gltf">
): string {
  return `previews/three_d/${partId}/${assetId}.${format}`;
}

/** ThreeDPreviewConversionFailureReason tags why one preview job failed. */
export type ThreeDPreviewConversionFailureReason =
  | "source_read_failed"
  | "converter_failed"
  | "artifact_write_failed";

/** ThreeDPreviewConverter converts STEP bytes into a browser-renderable artifact format. */
export interface ThreeDPreviewConverter {
  /** Converts STEP bytes into glTF/glb. Returns null when conversion is not supported. */
  convertStepToGltf(input: { stepBytes: Buffer; sourceAssetId: string; sourcePartId: string }): Promise<{
    bytes: Buffer;
    format: Extract<AssetPreviewArtifactFormat, "glb" | "gltf">;
  } | null>;
}

/** ThreeDPreviewJobResult is the per-asset outcome of one conversion attempt. */
export interface ThreeDPreviewJobResult {
  assetId: string;
  partId: string;
  status:
    | "converted"
    | "skipped_converter_unavailable"
    | "skipped_source_unreadable"
    | "conversion_failed";
  artifactStorageKey: string | null;
  artifactFormat: AssetPreviewArtifactFormat | null;
  failureReason: ThreeDPreviewConversionFailureReason | null;
  failureMessage: string | null;
}

/** ThreeDPreviewJobSummary reports one batch of conversion attempts for daemon telemetry. */
export interface ThreeDPreviewJobSummary {
  processed: ThreeDPreviewJobResult[];
}

/** ThreeDPreviewCandidateRow is one asset selected for conversion. */
interface ThreeDPreviewCandidateRow {
  id: string;
  part_id: string;
  storage_key: string;
}

/** activeConverter is the conversion implementation injected at startup or null when unconfigured. */
let activeConverter: ThreeDPreviewConverter | null = null;

/**
 * Replaces the active 3D preview converter. Pass null to clear (default state).
 *
 * Production wiring will call this from worker startup with a converter that shells out to
 * a configured CLI (e.g. CAD Exchanger / FreeCAD) when `EE_LIBRARY_STEP_TO_GLTF_CMD` is set;
 * tests pass a deterministic stub.
 */
export function setThreeDPreviewConverter(converter: ThreeDPreviewConverter | null): void {
  activeConverter = converter;
}

/**
 * Returns a converter built from the `EE_LIBRARY_STEP_TO_GLTF_CMD` environment variable when
 * present, otherwise null. The env-driven converter spawns the configured binary with the input
 * STEP path as `$1` and the output artifact path as `$2`, then reads the output bytes back.
 *
 * Honesty: returns null when the env var is unset so the worker stays in the
 * `skipped_converter_unavailable` branch rather than silently fabricating preview bytes.
 */
export function buildThreeDPreviewConverterFromEnv(): ThreeDPreviewConverter | null {
  const command = process.env["EE_LIBRARY_STEP_TO_GLTF_CMD"];
  if (!command || command.trim().length === 0) {
    return null;
  }

  const trimmedCommand = command.trim();
  const outputFormat = (process.env["EE_LIBRARY_STEP_TO_GLTF_FORMAT"] ?? "glb").trim().toLowerCase();
  if (outputFormat !== "glb" && outputFormat !== "gltf") {
    throw new Error(
      `EE_LIBRARY_STEP_TO_GLTF_FORMAT must be 'glb' or 'gltf' (got '${outputFormat}'). ` +
        "Refusing to start 3D preview converter so a misconfigured value cannot smuggle an unsupported format into the preview channel."
    );
  }

  return {
    async convertStepToGltf({ stepBytes, sourceAssetId }) {
      const workDir = await mkdtemp(join(tmpdir(), `three-d-preview-${sourceAssetId.replace(/[^a-z0-9-]/giu, "_")}-`));
      const inputPath = join(workDir, `${sourceAssetId}.step`);
      const outputPath = join(workDir, `${sourceAssetId}.${outputFormat}`);

      try {
        await writeFile(inputPath, stepBytes);
        await runConverterBinary(trimmedCommand, [inputPath, outputPath]);
        const artifactBytes = await readFile(outputPath);
        return { bytes: artifactBytes, format: outputFormat };
      } finally {
        await rm(workDir, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  };
}

/**
 * Spawns the configured converter binary and resolves only on a 0 exit code. Stderr is captured
 * for the failure path so an operator can see why the converter rejected the STEP.
 */
async function runConverterBinary(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const trimmedStderr = stderr.trim().slice(0, 1000);
      reject(new Error(`STEP→glTF converter exited ${code}${trimmedStderr ? `: ${trimmedStderr}` : ""}`));
    });
  });
}

/**
 * Reads up to `limit` STEP-backed three_d_model assets that need a preview artifact, runs the
 * configured converter against each, and persists the per-asset outcome. Bundle assembly's
 * "stop on first failure" pattern is intentionally **not** copied -- preview generation is
 * per-asset, so one failed conversion should not block the rest of the queue.
 */
export async function processPendingThreeDPreviewJobs(
  limit: number,
  storage: FileStorageClient
): Promise<ThreeDPreviewJobSummary> {
  const pool = getWorkerDatabasePool();
  const candidates = await readPendingThreeDPreviewCandidates(pool, Math.max(1, limit));
  const processed: ThreeDPreviewJobResult[] = [];

  for (const candidate of candidates) {
    processed.push(await processOneThreeDPreviewCandidate(pool, storage, candidate));
  }

  return { processed };
}

/**
 * Reads STEP-backed three_d_model assets that have:
 *   - a stored source file (`storage_key` set + availability `downloaded`/`validated`),
 *   - no derived preview artifact yet (`preview_artifact_storage_key IS NULL`).
 *
 * The query intentionally does **not** filter by `preview_status` so a row stuck in `pending`
 * (never converted) and a row demoted to `not_available` (converter failed previously) are both
 * candidates for re-attempt. Honesty: if the source file is gone, the row is **not** selected
 * here -- the worker normalization helper at write time will have already cleared the channel.
 */
async function readPendingThreeDPreviewCandidates(
  pool: Pool,
  limit: number
): Promise<ThreeDPreviewCandidateRow[]> {
  const result = await pool.query<ThreeDPreviewCandidateRow>(
    `
      SELECT id, part_id, storage_key
      FROM assets
      WHERE asset_type = 'three_d_model'
        AND file_format = 'step'
        AND availability_status IN ('downloaded', 'validated')
        AND storage_key IS NOT NULL
        AND preview_artifact_storage_key IS NULL
      ORDER BY last_updated_at ASC, id ASC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

/**
 * Runs one STEP→glTF conversion and persists the outcome.
 *
 * Persisted state is restricted to the four preview-artifact columns plus `preview_status`. The
 * source asset's review / validation / export status is left untouched -- those gates are owned
 * by the trust pipeline and must not move because a preview artifact happened to render.
 */
async function processOneThreeDPreviewCandidate(
  pool: Pool,
  storage: FileStorageClient,
  candidate: ThreeDPreviewCandidateRow
): Promise<ThreeDPreviewJobResult> {
  const converter = activeConverter;
  if (!converter) {
    return {
      artifactFormat: null,
      artifactStorageKey: null,
      assetId: candidate.id,
      failureMessage: null,
      failureReason: null,
      partId: candidate.part_id,
      status: "skipped_converter_unavailable"
    };
  }

  let stepBytes: Buffer;
  try {
    stepBytes = await storage.read(candidate.storage_key);
  } catch (error) {
    return {
      artifactFormat: null,
      artifactStorageKey: null,
      assetId: candidate.id,
      failureMessage: formatPreviewError(error),
      failureReason: "source_read_failed",
      partId: candidate.part_id,
      status: "skipped_source_unreadable"
    };
  }

  let conversionOutcome: { bytes: Buffer; format: "glb" | "gltf" } | null;
  try {
    conversionOutcome = await converter.convertStepToGltf({
      sourceAssetId: candidate.id,
      sourcePartId: candidate.part_id,
      stepBytes
    });
  } catch (error) {
    return {
      artifactFormat: null,
      artifactStorageKey: null,
      assetId: candidate.id,
      failureMessage: formatPreviewError(error),
      failureReason: "converter_failed",
      partId: candidate.part_id,
      status: "conversion_failed"
    };
  }

  if (!conversionOutcome) {
    return {
      artifactFormat: null,
      artifactStorageKey: null,
      assetId: candidate.id,
      failureMessage: null,
      failureReason: null,
      partId: candidate.part_id,
      status: "skipped_converter_unavailable"
    };
  }

  const artifactStorageKey = buildThreeDPreviewArtifactStorageKey(candidate.part_id, candidate.id, conversionOutcome.format);
  try {
    await storage.write(artifactStorageKey, conversionOutcome.bytes);
  } catch (error) {
    return {
      artifactFormat: null,
      artifactStorageKey: null,
      assetId: candidate.id,
      failureMessage: formatPreviewError(error),
      failureReason: "artifact_write_failed",
      partId: candidate.part_id,
      status: "conversion_failed"
    };
  }

  await persistThreeDPreviewArtifactRow(pool, {
    assetId: candidate.id,
    artifactFormat: conversionOutcome.format,
    artifactStorageKey,
    generatedAt: new Date()
  });

  return {
    artifactFormat: conversionOutcome.format,
    artifactStorageKey,
    assetId: candidate.id,
    failureMessage: null,
    failureReason: null,
    partId: candidate.part_id,
    status: "converted"
  };
}

/**
 * Persists one asset's preview-artifact channel and promotes `preview_status` to `ready`.
 *
 * Only the preview channel is updated -- never the source review / validation / export status.
 */
async function persistThreeDPreviewArtifactRow(
  pool: Pool,
  input: {
    assetId: string;
    artifactStorageKey: string;
    artifactFormat: Asset["previewArtifactFormat"];
    generatedAt: Date;
  }
): Promise<void> {
  await pool.query(
    `
      UPDATE assets
      SET preview_artifact_storage_key = $2,
          preview_artifact_format = $3,
          preview_artifact_source = 'converter_step_to_gltf',
          preview_artifact_generated_at = $4,
          preview_status = 'ready'
      WHERE id = $1
    `,
    [input.assetId, input.artifactStorageKey, input.artifactFormat, input.generatedAt]
  );
}

/**
 * Bounds an unknown failure into a stable string for telemetry.
 */
function formatPreviewError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, 1000);
}
