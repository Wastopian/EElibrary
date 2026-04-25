/**
 * File header: Tests resolveStorageKey path-traversal rejection and LocalFileStorageClient write/URL behavior.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileStorageClientFromEnv, resolveStorageKey } from "./file-storage";

test("resolveStorageKey returns absolute path for a normal key", () => {
  const result = resolveStorageKey("/storage", "cad/a.step");

  assert.ok(result !== null);
  assert.ok(result.includes("a.step"));
});

test("resolveStorageKey returns null for a path traversal attempt using double-dot", () => {
  assert.equal(resolveStorageKey("/storage", "../etc/passwd"), null);
});

test("resolveStorageKey returns null for a key that escapes the base via URL encoding variant", () => {
  assert.equal(resolveStorageKey("/storage", "../../secret"), null);
});

test("resolveStorageKey returns null for a key containing encoded traversal segments", () => {
  assert.equal(resolveStorageKey("/storage", "cad/../../secret"), null);
});

test("resolveStorageKey accepts a key at the root level (no directory component)", () => {
  const result = resolveStorageKey("/storage", "file.pdf");

  assert.ok(result !== null);
  assert.match(result, /file\.pdf$/u);
});

test("LocalFileStorageClient.write creates file at correct path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ee-storage-test-"));

  try {
    const previousBackend = process.env["STORAGE_BACKEND"];
    const previousPath = process.env["STORAGE_LOCAL_PATH"];
    process.env["STORAGE_BACKEND"] = "local";
    process.env["STORAGE_LOCAL_PATH"] = tempDir;
    process.env["STORAGE_SERVE_BASE_URL"] = "http://127.0.0.1:4000";

    try {
      const client = createFileStorageClientFromEnv();
      await client.write("datasheets/test.pdf", Buffer.from("PDF content"));

      const written = await readFile(join(tempDir, "datasheets", "test.pdf"), "utf8");
      assert.equal(written, "PDF content");
    } finally {
      restoreEnv("STORAGE_BACKEND", previousBackend);
      restoreEnv("STORAGE_LOCAL_PATH", previousPath);
      delete process.env["STORAGE_SERVE_BASE_URL"];
    }
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test("LocalFileStorageClient.write creates parent directories that do not exist", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ee-storage-test-"));

  try {
    const previousPath = process.env["STORAGE_LOCAL_PATH"];
    process.env["STORAGE_BACKEND"] = "local";
    process.env["STORAGE_LOCAL_PATH"] = tempDir;
    process.env["STORAGE_SERVE_BASE_URL"] = "http://127.0.0.1:4000";

    try {
      const client = createFileStorageClientFromEnv();
      await client.write("deep/nested/dir/file.step", Buffer.from("STEP data"));

      const written = await readFile(join(tempDir, "deep", "nested", "dir", "file.step"), "utf8");
      assert.equal(written, "STEP data");
    } finally {
      restoreEnv("STORAGE_LOCAL_PATH", previousPath);
      delete process.env["STORAGE_BACKEND"];
      delete process.env["STORAGE_SERVE_BASE_URL"];
    }
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test("LocalFileStorageClient.write throws for a path traversal key", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ee-storage-test-"));

  try {
    process.env["STORAGE_BACKEND"] = "local";
    process.env["STORAGE_LOCAL_PATH"] = tempDir;
    process.env["STORAGE_SERVE_BASE_URL"] = "http://127.0.0.1:4000";

    try {
      const client = createFileStorageClientFromEnv();
      await assert.rejects(() => client.write("../../escape.txt", Buffer.from("bad")), /path traversal/iu);
    } finally {
      delete process.env["STORAGE_BACKEND"];
      delete process.env["STORAGE_LOCAL_PATH"];
      delete process.env["STORAGE_SERVE_BASE_URL"];
    }
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test("LocalFileStorageClient.getDownloadUrl returns URL with encoded key", async () => {
  const previousPath = process.env["STORAGE_LOCAL_PATH"];
  process.env["STORAGE_BACKEND"] = "local";
  process.env["STORAGE_LOCAL_PATH"] = "./storage";
  process.env["STORAGE_SERVE_BASE_URL"] = "http://127.0.0.1:4000";

  try {
    const client = createFileStorageClientFromEnv();
    const url = await client.getDownloadUrl("cad/part-a.step");

    assert.equal(url, "http://127.0.0.1:4000/storage/cad%2Fpart-a.step");
  } finally {
    restoreEnv("STORAGE_LOCAL_PATH", previousPath);
    delete process.env["STORAGE_BACKEND"];
    delete process.env["STORAGE_SERVE_BASE_URL"];
  }
});

test("LocalFileStorageClient.getDownloadUrl returns null for a path traversal key", async () => {
  process.env["STORAGE_BACKEND"] = "local";
  process.env["STORAGE_LOCAL_PATH"] = "./storage";
  process.env["STORAGE_SERVE_BASE_URL"] = "http://127.0.0.1:4000";

  try {
    const client = createFileStorageClientFromEnv();
    const url = await client.getDownloadUrl("../../etc/passwd");

    assert.equal(url, null);
  } finally {
    delete process.env["STORAGE_BACKEND"];
    delete process.env["STORAGE_LOCAL_PATH"];
    delete process.env["STORAGE_SERVE_BASE_URL"];
  }
});

test("createFileStorageClientFromEnv returns not_configured backend for unknown STORAGE_BACKEND", async () => {
  process.env["STORAGE_BACKEND"] = "unsupported_future_backend";

  try {
    const client = createFileStorageClientFromEnv();
    assert.equal(client.backend, "not_configured");

    const url = await client.getDownloadUrl("any.pdf");
    assert.equal(url, null);
  } finally {
    delete process.env["STORAGE_BACKEND"];
  }
});

test("LocalFileStorageClient.backend reports local", () => {
  const previousBackend = process.env["STORAGE_BACKEND"];
  process.env["STORAGE_BACKEND"] = "local";

  try {
    const client = createFileStorageClientFromEnv();
    assert.equal(client.backend, "local");
  } finally {
    restoreEnv("STORAGE_BACKEND", previousBackend);
  }
});

/**
 * Restores an environment variable to its previous value.
 */
function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
