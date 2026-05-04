/**
 * File header: Runs TypeScript test files on Windows and POSIX without relying on shell glob expansion.
 */

import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** workspaceRoot is the package directory where npm invoked this script. */
const workspaceRoot = process.cwd();

/** searchRoots are directories or files passed by the package test script. */
const searchRoots = process.argv.slice(2);

/**
 * Finds test files under all requested roots and runs them through Node's test runner.
 */
async function main() {
  const testFiles = (await Promise.all((searchRoots.length > 0 ? searchRoots : ["src"]).map((entry) => collectTestFiles(path.resolve(workspaceRoot, entry))))).flat().sort();

  if (testFiles.length === 0) {
    console.log("No test files found.");
    return;
  }

  // EE_LIBRARY_ALLOW_TEST_AUTH=1 opts the API auth layer into the deterministic test admin
  // session. Without this the auth middleware fails closed even when NODE_ENV === "test", so
  // a misconfigured production deploy that inherits NODE_ENV cannot accidentally grant admin.
  // Only the test runner sets this flag.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      EE_LIBRARY_ALLOW_TEST_AUTH: "1",
      NODE_ENV: "test"
    },
    stdio: "inherit"
  });

  process.exitCode = result.status ?? 1;
}

/**
 * Recursively collects .test.ts files from one file or directory.
 */
async function collectTestFiles(entryPath) {
  const entryStat = await stat(entryPath).catch(() => null);

  if (!entryStat) {
    return [];
  }

  if (entryStat.isFile()) {
    return entryPath.endsWith(".test.ts") ? [entryPath] : [];
  }

  if (!entryStat.isDirectory()) {
    return [];
  }

  const entries = await readdir(entryPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map((entry) => collectTestFiles(path.join(entryPath, entry.name))));

  return nestedFiles.flat();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
