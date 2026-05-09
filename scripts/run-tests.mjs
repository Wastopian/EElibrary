/**
 * File header: Runs TypeScript test files on Windows and POSIX without relying on shell glob expansion.
 *
 * Node's `--test` flag treats positional file arguments as glob patterns, so absolute
 * Windows paths containing `[` or `]` (e.g. Next.js dynamic route folders like
 * `[projectId]`) can be interpreted as character classes and silently match nothing.
 * To avoid that, this script discovers test files itself and passes relative POSIX-style
 * paths to the runner; those paths are stable across Windows and POSIX shells.
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
  const resolvedRoots = (searchRoots.length > 0 ? searchRoots : ["src"]).map((entry) => path.resolve(workspaceRoot, entry));
  const testFiles = (await Promise.all(resolvedRoots.map((entry) => collectTestFiles(entry)))).flat().sort();

  const baseArgs = ["--import", "tsx", "--test"];
  if (testFiles.length === 0) {
    console.log("No test files found.");
    return;
  }

  const runnerArgs = [...baseArgs, ...testFiles.map(toRunnerPath)];

  // EE_LIBRARY_ALLOW_TEST_AUTH=1 opts the API auth layer into the deterministic test admin
  // session. Without this the auth middleware fails closed even when NODE_ENV === "test", so
  // a misconfigured production deploy that inherits NODE_ENV cannot accidentally grant admin.
  // Only the test runner sets this flag.
  const result = spawnSync(process.execPath, runnerArgs, {
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
 * Recursively collects `.test.ts` / `.test.tsx` files from one file or directory.
 */
function isTestFile(filePath) {
  return filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx");
}

async function collectTestFiles(entryPath) {
  const entryStat = await stat(entryPath).catch(() => null);

  if (!entryStat) {
    return [];
  }

  if (entryStat.isFile()) {
    return isTestFile(entryPath) ? [entryPath] : [];
  }

  if (!entryStat.isDirectory()) {
    return [];
  }

  const entries = await readdir(entryPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map((entry) => collectTestFiles(path.join(entryPath, entry.name))));

  return nestedFiles.flat();
}

/**
 * Converts an absolute file path into the relative slash-separated form Node's test
 * runner handles reliably, including Next.js dynamic-route folders on Windows.
 */
function toRunnerPath(filePath) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
