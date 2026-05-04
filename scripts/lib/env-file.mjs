/**
 * File header: Helpers for reading, writing, and merging local .env files idempotently.
 */

import { readFile, writeFile, copyFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

/**
 * Returns true when the given path exists.
 */
export async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies sourcePath to targetPath only when targetPath does not exist.
 * Returns "copied" when a copy happened and "exists" when the target was preserved.
 */
export async function copyIfMissing(sourcePath, targetPath) {
  if (await pathExists(targetPath)) {
    return "exists";
  }

  await copyFile(sourcePath, targetPath);
  return "copied";
}

/**
 * Parses a dotenv-formatted string into a Map preserving insertion order.
 * Supports KEY=VALUE pairs and #-prefixed comment lines. Quoted values are unwrapped.
 */
export function parseEnv(text) {
  const entries = new Map();

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");

    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    entries.set(key, value);
  }

  return entries;
}

/**
 * Reads a .env file and returns a Map. Returns an empty Map when the file is missing.
 */
export async function readEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
    return parseEnv(text);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

/**
 * Writes a Map of env entries back to disk preserving order with KEY=VALUE lines.
 * Values that contain spaces or special chars are wrapped in double quotes.
 */
export async function writeEnvFile(path, entries) {
  const lines = [];

  for (const [key, value] of entries) {
    lines.push(`${key}=${formatValue(value)}`);
  }

  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Updates a single key in a .env file only when the key is missing or empty.
 * Returns "added" when the key was written, "exists" when it was already set.
 */
export async function ensureEnvKey(path, key, valueFactory) {
  const current = await readEnvFile(path);
  const existing = current.get(key);

  if (typeof existing === "string" && existing.length > 0) {
    return { status: "exists", value: existing };
  }

  const value = await valueFactory();

  current.set(key, value);
  await writeEnvFile(path, current);

  return { status: "added", value };
}

/**
 * Formats a value for safe storage in a .env file.
 */
function formatValue(value) {
  if (value === "") {
    return "";
  }

  if (/[\s#"']/u.test(value)) {
    return `"${value.replace(/"/gu, '\\"')}"`;
  }

  return value;
}
