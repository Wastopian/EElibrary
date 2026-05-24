/**
 * File header: Worker entrypoint for KiCad library emission.
 *
 * The emission logic (asset selection, grouping, packaging) lives in `@ee-library/shared` so the API
 * can run it inline too. This module re-exports that core and adds the worker-globals wrapper the CLI
 * uses, defaulting the pool and storage client from the worker environment.
 */

import { emitKicadLibraryForProjectWithDeps, type KicadLibraryEmissionSummary } from "@ee-library/shared/kicad-library-emission";
import { getWorkerDatabasePool } from "./catalog-repository";
import { getWorkerStorageClient } from "./file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

export * from "@ee-library/shared/kicad-library-emission";

/**
 * Emits a KiCad library for one project using the worker's database pool and storage client by
 * default. Thin wrapper over the shared `emitKicadLibraryForProjectWithDeps`.
 */
export async function emitKicadLibraryForProject(
  projectId: string,
  options: {
    revisionLabel?: string | undefined;
    storage?: FileStorageClient | undefined;
    pool?: Pool | undefined;
    generatedAt?: string | undefined;
  } = {}
): Promise<KicadLibraryEmissionSummary> {
  const pool = options.pool ?? getWorkerDatabasePool();
  const storage = options.storage ?? getWorkerStorageClient();

  return emitKicadLibraryForProjectWithDeps(pool, storage, projectId, {
    generatedAt: options.generatedAt,
    revisionLabel: options.revisionLabel
  });
}
