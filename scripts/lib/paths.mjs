/**
 * File header: Resolves repository-relative paths so scripts work from any cwd.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** repoRoot points to the monorepo root regardless of where the script was invoked from. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Resolves a path relative to the repository root.
 */
export function fromRepoRoot(...segments) {
  return resolve(repoRoot, ...segments);
}
