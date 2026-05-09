/**
 * File header: Tests project file mirror service against a sandboxed temp directory.
 *
 * Each test sets `EE_LIBRARY_PROJECT_FILES_ROOT` to a unique temp folder so we can verify
 * folder creation, listing, hidden-file filtering, sanitization, and traversal refusal
 * without touching the operator's home directory.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildProjectFilesResponse,
  getProjectFilesRoot,
  resolveProjectFolderCategory,
  sanitizeProjectKey,
  sanitizeUploadFilename,
  saveProjectFile,
  PROJECT_FOLDER_DEFINITIONS
} from "./project-files";

/**
 * Creates a unique sandbox root for one test and points the env var at it.
 * Returns a teardown function that restores the env var and removes the directory.
 */
async function withSandboxRoot(): Promise<{ root: string; restore: () => Promise<void> }> {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  const root = await mkdtemp(path.join(tmpdir(), "ee-project-files-"));
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = root;

  return {
    root,
    restore: async () => {
      if (previous === undefined) {
        delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
      } else {
        process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
      }
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("getProjectFilesRoot uses the default folder for empty values and off disables it", () => {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  try {
    process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "";
    assert.ok(getProjectFilesRoot()?.endsWith(path.join("EE-Library", "projects")));

    process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";
    assert.equal(getProjectFilesRoot(), null);
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
    } else {
      process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
    }
  }
});

test("sanitizeProjectKey strips traversal-prone characters and preserves dashes", () => {
  assert.equal(sanitizeProjectKey("ALPHA"), "ALPHA");
  assert.equal(sanitizeProjectKey("alpha-1"), "alpha-1");
  assert.equal(sanitizeProjectKey("alpha 1"), "alpha-1");
  assert.equal(sanitizeProjectKey("../../etc"), "etc");
  assert.equal(sanitizeProjectKey("./..\\bad"), "bad");
  assert.equal(sanitizeProjectKey("a/b\\c"), "a-b-c");
  assert.equal(sanitizeProjectKey("    "), "project");
  assert.equal(sanitizeProjectKey("..."), "project");
});

test("buildProjectFilesResponse returns not_configured when env var is off", async () => {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";

  try {
    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });
    assert.equal(response.availability, "not_configured");
    assert.equal(response.rootPath, null);
    assert.deepEqual(response.folders, []);
    assert.equal(response.message, null);
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
    } else {
      process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
    }
  }
});

test("buildProjectFilesResponse creates the canonical subfolders on first read", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });

    assert.equal(response.availability, "configured");
    assert.equal(response.projectKey, "ALPHA");
    assert.equal(response.folders.length, PROJECT_FOLDER_DEFINITIONS.length);
    assert.deepEqual(
      response.folders.map((folder) => folder.category),
      PROJECT_FOLDER_DEFINITIONS.map((folder) => folder.category)
    );
    for (const folder of response.folders) {
      assert.ok(folder.absolutePath.startsWith(sandbox.root), `folder ${folder.category} stays inside the sandbox root`);
      assert.deepEqual(folder.entries, []);
    }
  } finally {
    await sandbox.restore();
  }
});

test("buildProjectFilesResponse surfaces files dropped directly into the on-disk folder", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const partsListPath = path.join(sandbox.root, "ALPHA", "parts-list");
    await mkdir(partsListPath, { recursive: true });
    await writeFile(path.join(partsListPath, "alpha-bom.csv"), "ref,mpn\nC1,GRM21");
    await writeFile(path.join(partsListPath, ".DS_Store"), "ignored");

    const datasheetsPath = path.join(sandbox.root, "ALPHA", "datasheets");
    await mkdir(datasheetsPath, { recursive: true });
    await writeFile(path.join(datasheetsPath, "GRM21.pdf"), "%PDF-1.4");

    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });
    assert.equal(response.availability, "configured");

    const partsList = response.folders.find((folder) => folder.category === "parts_list");
    assert.ok(partsList);
    assert.deepEqual(
      partsList.entries.map((entry) => entry.name),
      ["alpha-bom.csv"]
    );
    const firstPartsEntry = partsList.entries[0];
    assert.ok(firstPartsEntry);
    assert.equal(firstPartsEntry.isFile, true);
    assert.equal(typeof firstPartsEntry.sizeBytes, "number");

    const datasheets = response.folders.find((folder) => folder.category === "datasheets");
    assert.ok(datasheets);
    assert.equal(datasheets.entries[0]?.name, "GRM21.pdf");

    const models = response.folders.find((folder) => folder.category === "models");
    assert.ok(models);
    assert.deepEqual(models.entries, []);
  } finally {
    await sandbox.restore();
  }
});

test("buildProjectFilesResponse refuses to escape the configured root", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "../../escape" });
    assert.equal(response.availability, "configured", "sanitizer keeps the request inside the sandbox");
    assert.equal(response.projectKey, "escape");
    for (const folder of response.folders) {
      assert.ok(folder.absolutePath.startsWith(sandbox.root), `folder ${folder.category} stays sandboxed`);
    }
  } finally {
    await sandbox.restore();
  }
});

test("buildProjectFilesResponse falls back to project when projectKey is whitespace", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const response = await buildProjectFilesResponse({ id: "project-blank", projectKey: "   " });
    assert.equal(response.projectKey, "project");
    assert.ok(response.rootPath?.endsWith(`${path.sep}project`));
  } finally {
    await sandbox.restore();
  }
});

test("PROJECT_FOLDER_DEFINITIONS includes the notes category", () => {
  const categories = PROJECT_FOLDER_DEFINITIONS.map((folder) => folder.category);
  assert.deepEqual(categories, ["parts_list", "datasheets", "models", "notes"]);
});

test("resolveProjectFolderCategory rejects unknown categories", () => {
  assert.equal(resolveProjectFolderCategory("notes"), "notes");
  assert.equal(resolveProjectFolderCategory("datasheets"), "datasheets");
  assert.equal(resolveProjectFolderCategory("evidence"), null);
  assert.equal(resolveProjectFolderCategory(""), null);
  assert.equal(resolveProjectFolderCategory("../../etc"), null);
});

test("sanitizeUploadFilename strips path separators and normalizes whitespace", () => {
  assert.equal(sanitizeUploadFilename("alpha-bom.csv"), "alpha-bom.csv");
  assert.equal(sanitizeUploadFilename("Some Notes.MD"), "Some-Notes.md");
  assert.equal(sanitizeUploadFilename("../../escape.txt"), "escape.txt");
  assert.equal(sanitizeUploadFilename("C:\\\\bad\\\\path.pdf"), "path.pdf");
  assert.equal(sanitizeUploadFilename(".hidden"), "hidden");
  assert.equal(sanitizeUploadFilename("README"), "README");
  assert.equal(sanitizeUploadFilename("...."), null);
  assert.equal(sanitizeUploadFilename(""), null);
});

test("saveProjectFile writes base64 binary content to the requested category", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "datasheets",
      {
        filename: "GRM21.pdf",
        contentBase64: Buffer.from("%PDF-1.4 mock", "utf8").toString("base64")
      }
    );

    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.entry.name, "GRM21.pdf");
    assert.equal(result.entry.isFile, true);
    assert.ok(result.absolutePath.endsWith(path.join("ALPHA", "datasheets", "GRM21.pdf")));

    const onDisk = await readFile(result.absolutePath, "utf8");
    assert.equal(onDisk, "%PDF-1.4 mock");
  } finally {
    await sandbox.restore();
  }
});

test("saveProjectFile writes UTF-8 text directly when content is provided", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "notes",
      {
        filename: "Considered alternates.md",
        content: "# Considered alternates\n\nGRM31 was rejected; lead time too long."
      }
    );

    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.entry.name, "Considered-alternates.md");

    const onDisk = await readFile(result.absolutePath, "utf8");
    assert.match(onDisk, /Considered alternates/);
    assert.match(onDisk, /lead time too long/);
  } finally {
    await sandbox.restore();
  }
});

test("saveProjectFile appends a numeric suffix on filename collisions", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const project = { id: "project-alpha", projectKey: "ALPHA" };
    const first = await saveProjectFile(project, "notes", { filename: "decision.md", content: "first" });
    const second = await saveProjectFile(project, "notes", { filename: "decision.md", content: "second" });
    const third = await saveProjectFile(project, "notes", { filename: "decision.md", content: "third" });

    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    assert.equal(third.status, "ok");
    if (first.status !== "ok" || second.status !== "ok" || third.status !== "ok") {
      return;
    }
    assert.equal(first.entry.name, "decision.md");
    assert.equal(second.entry.name, "decision-1.md");
    assert.equal(third.entry.name, "decision-2.md");
  } finally {
    await sandbox.restore();
  }
});

test("saveProjectFile rejects empty filenames after sanitization", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "datasheets",
      { filename: "...", content: "x" }
    );
    assert.equal(result.status, "invalid_filename");
  } finally {
    await sandbox.restore();
  }
});

test("saveProjectFile rejects requests missing both content and contentBase64", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "notes",
      { filename: "blank.md" }
    );
    assert.equal(result.status, "invalid_content");
  } finally {
    await sandbox.restore();
  }
});

test("saveProjectFile rejects malformed base64", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "datasheets",
      { filename: "bad.pdf", contentBase64: "not-base64-***" }
    );
    assert.equal(result.status, "invalid_content");
  } finally {
    await sandbox.restore();
  }
});

test("saveProjectFile returns not_configured when the env var is off", async () => {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "notes",
      { filename: "x.md", content: "x" }
    );
    assert.equal(result.status, "not_configured");
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
    } else {
      process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
    }
  }
});

test("saveProjectFile keeps writes inside the sandboxed project root", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveProjectFile(
      { id: "project-alpha", projectKey: "ALPHA" },
      "datasheets",
      { filename: "../../escape.pdf", content: "x" }
    );

    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.entry.name, "escape.pdf");
    assert.ok(result.absolutePath.startsWith(sandbox.root));
    assert.ok(result.absolutePath.includes(path.join("ALPHA", "datasheets")));
  } finally {
    await sandbox.restore();
  }
});
