/**
 * File header: Tests for the .env parsing, copy-if-missing, and ensureEnvKey helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  copyIfMissing,
  ensureEnvKey,
  parseEnv,
  pathExists,
  readEnvFile,
  writeEnvFile
} from "../lib/env-file.mjs";

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "ee-env-"));
}

test("parseEnv ignores comments and blank lines", () => {
  const entries = parseEnv("# header\n\nKEY=value\nANOTHER=hello world\n");
  assert.equal(entries.size, 2);
  assert.equal(entries.get("KEY"), "value");
  assert.equal(entries.get("ANOTHER"), "hello world");
});

test("parseEnv unwraps quoted values", () => {
  const entries = parseEnv('A="quoted value"\nB=\'single\'\nC=plain\n');
  assert.equal(entries.get("A"), "quoted value");
  assert.equal(entries.get("B"), "single");
  assert.equal(entries.get("C"), "plain");
});

test("readEnvFile returns empty Map for missing file", async () => {
  const dir = await makeTempDir();
  try {
    const entries = await readEnvFile(join(dir, "missing.env"));
    assert.equal(entries.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeEnvFile + readEnvFile round-trip preserves order and values", async () => {
  const dir = await makeTempDir();
  try {
    const path = join(dir, ".env");
    const entries = new Map([
      ["FIRST", "1"],
      ["SECOND", "two words"],
      ["THIRD", "with#hash"]
    ]);
    await writeEnvFile(path, entries);
    const roundTripped = await readEnvFile(path);
    assert.deepEqual(Array.from(roundTripped.entries()), Array.from(entries.entries()));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("copyIfMissing copies when target absent and skips when present", async () => {
  const dir = await makeTempDir();
  try {
    const source = join(dir, ".env.example");
    const target = join(dir, ".env");
    await writeFile(source, "FOO=bar\n", "utf8");

    const first = await copyIfMissing(source, target);
    assert.equal(first, "copied");
    assert.equal(await pathExists(target), true);

    await writeFile(target, "FOO=different\n", "utf8");
    const second = await copyIfMissing(source, target);
    assert.equal(second, "exists");
    assert.equal(await readFile(target, "utf8"), "FOO=different\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureEnvKey adds missing key but never overwrites an existing one", async () => {
  const dir = await makeTempDir();
  try {
    const path = join(dir, ".env");
    await writeFile(path, "PORT=4000\n", "utf8");

    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      return "generated-secret";
    };

    const first = await ensureEnvKey(path, "AUTH_SECRET", factory);
    assert.equal(first.status, "added");
    assert.equal(first.value, "generated-secret");
    assert.equal(factoryCalls, 1);

    const second = await ensureEnvKey(path, "AUTH_SECRET", factory);
    assert.equal(second.status, "exists");
    assert.equal(second.value, "generated-secret");
    assert.equal(factoryCalls, 1, "factory must not be invoked when key already exists");

    const final = await readEnvFile(path);
    assert.equal(final.get("PORT"), "4000");
    assert.equal(final.get("AUTH_SECRET"), "generated-secret");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureEnvKey treats empty string value as missing", async () => {
  const dir = await makeTempDir();
  try {
    const path = join(dir, ".env");
    await writeFile(path, "AUTH_SECRET=\n", "utf8");

    const result = await ensureEnvKey(path, "AUTH_SECRET", () => "fresh");
    assert.equal(result.status, "added");
    assert.equal(result.value, "fresh");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
