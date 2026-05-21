/**
 * File header: Tests project file mirror service against a sandboxed temp directory.
 *
 * Each test sets `EE_LIBRARY_PROJECT_FILES_ROOT` to a unique temp folder so we can verify
 * folder creation, listing, hidden-file filtering, sanitization, and traversal refusal
 * without touching the operator's home directory.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildProjectFilesResponse,
  ensureProjectMirrorForKey,
  getCustomHardwarePrefixes,
  getProjectFilesSettingsPath,
  getProjectFilesRoot,
  listDiscoveredProjectFolders,
  readProjectFilesRootSettings,
  resolveProjectFolderCategory,
  sanitizeProjectKey,
  sanitizeUploadFilename,
  saveProjectFile,
  updateProjectFilesRootSettings,
  PROJECT_FOLDER_DEFINITIONS
} from "./project-files";

/**
 * Creates a unique sandbox root for one test and points the env var at it.
 * Returns a teardown function that restores the env var and removes the directory.
 */
async function withSandboxRoot(): Promise<{ root: string; restore: () => Promise<void> }> {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  const previousSettingsPath = process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
  const root = await mkdtemp(path.join(tmpdir(), "ee-project-files-"));
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = root;
  process.env.EE_LIBRARY_SITE_SETTINGS_PATH = path.join(root, "site-settings.json");

  return {
    root,
    restore: async () => {
      if (previous === undefined) {
        delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
      } else {
        process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
      }
      if (previousSettingsPath === undefined) {
        delete process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
      } else {
        process.env.EE_LIBRARY_SITE_SETTINGS_PATH = previousSettingsPath;
      }
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("getProjectFilesRoot uses the default folder for empty values and off disables it", async () => {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  const previousSettingsPath = process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
  const settingsRoot = await mkdtemp(path.join(tmpdir(), "ee-project-files-settings-"));
  try {
    process.env.EE_LIBRARY_SITE_SETTINGS_PATH = path.join(settingsRoot, "site-settings.json");
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
    if (previousSettingsPath === undefined) {
      delete process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
    } else {
      process.env.EE_LIBRARY_SITE_SETTINGS_PATH = previousSettingsPath;
    }
    await rm(settingsRoot, { recursive: true, force: true });
  }
});

test("project file root settings persist an admin-selected folder before env/default roots", async () => {
  const sandbox = await withSandboxRoot();
  const siteRoot = path.join(sandbox.root, "admin-selected-projects");

  try {
    const initial = readProjectFilesRootSettings();
    assert.equal(initial.source, "environment");
    assert.equal(initial.environmentRootPath, sandbox.root);

    const updated = await updateProjectFilesRootSettings({ rootPath: siteRoot });
    assert.equal(updated.source, "site_setting");
    assert.equal(updated.currentRootPath, siteRoot);
    assert.equal(getProjectFilesRoot(), siteRoot);
    assert.equal(getProjectFilesSettingsPath(), path.join(sandbox.root, "site-settings.json"));

    const persisted = JSON.parse(await readFile(path.join(sandbox.root, "site-settings.json"), "utf8")) as Record<string, unknown>;
    assert.equal(persisted.projectFilesRoot, siteRoot);

    const reset = await updateProjectFilesRootSettings({ resetToDefault: true });
    assert.equal(reset.source, "environment");
    assert.equal(reset.currentRootPath, sandbox.root);
  } finally {
    await sandbox.restore();
  }
});

test("getCustomHardwarePrefixes defaults to common prefixes and accepts team overrides", () => {
  const previous = process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES;
  try {
    delete process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES;
    assert.deepEqual(getCustomHardwarePrefixes(), ["ICD", "PCA", "PTA"]);

    process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES = "pta, pca; jig ICD bad-prefix!";
    assert.deepEqual(getCustomHardwarePrefixes(), ["BADPREFIX", "ICD", "JIG", "PCA", "PTA"]);

    process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES = "-";
    assert.deepEqual(getCustomHardwarePrefixes(), ["ICD", "PCA", "PTA"]);
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES;
    } else {
      process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES = previous;
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
  const previousSettingsPath = process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
  const settingsRoot = await mkdtemp(path.join(tmpdir(), "ee-project-files-settings-"));
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";
  process.env.EE_LIBRARY_SITE_SETTINGS_PATH = path.join(settingsRoot, "site-settings.json");

  try {
    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });
    assert.equal(response.availability, "not_configured");
    assert.equal(response.rootPath, null);
    assert.deepEqual(response.folders, []);
    assert.equal(response.message, null);
    assert.equal(response.customHardware, null);
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
    } else {
      process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
    }
    if (previousSettingsPath === undefined) {
      delete process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
    } else {
      process.env.EE_LIBRARY_SITE_SETTINGS_PATH = previousSettingsPath;
    }
    await rm(settingsRoot, { recursive: true, force: true });
  }
});

test("listDiscoveredProjectFolders returns top-level directories from the mirror root", async () => {
  const sandbox = await withSandboxRoot();

  try {
    await mkdir(path.join(sandbox.root, "trialProject1", "parts-list"), { recursive: true });
    await mkdir(path.join(sandbox.root, ".hidden"), { recursive: true });
    await writeFile(path.join(sandbox.root, "readme.txt"), "not a project");

    const discovery = await listDiscoveredProjectFolders();

    assert.equal(discovery.availability, "configured");
    assert.equal(discovery.folders.length, 1);
    assert.equal(discovery.folders[0]?.folderName, "trialProject1");
    assert.equal(discovery.folders[0]?.projectKey, "trialProject1");
  } finally {
    await sandbox.restore();
  }
});

test("ensureProjectMirrorForKey reuses an existing folder when only the casing differs", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const existingPath = path.join(sandbox.root, "trialProject1");
    await mkdir(path.join(existingPath, "datasheets"), { recursive: true });

    const ensured = await ensureProjectMirrorForKey("TRIALPROJECT1");

    assert.equal(ensured.availability, "configured");
    assert.equal(ensured.projectRoot, existingPath);
    await access(path.join(existingPath, "parts-list"));
  } finally {
    await sandbox.restore();
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

test("buildProjectFilesResponse lists custom design folders and parts-list references", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const partsListPath = path.join(sandbox.root, "ALPHA", "parts-list");
    await mkdir(partsListPath, { recursive: true });
    await writeFile(
      path.join(partsListPath, "alpha-bom.csv"),
      "Designator,MPN,Notes\nJIG1,PTA-1001,Bring-up adapter\nJIG2,PCA.2002,Referenced before folder exists\nJIG3,ICD-10,Debug cable\nJIG4,FIXTURE_7,Discovered prefix from design folder\n",
      "utf8"
    );

    const ptaFolderPath = path.join(sandbox.root, "ALPHA", "hardware", "PTA-1001");
    await mkdir(ptaFolderPath, { recursive: true });
    await writeFile(
      path.join(ptaFolderPath, "README.md"),
      [
        "# PTA-1001",
        "",
        "Connects to: J1 battery harness and SWD pogo header",
        "Tests: MCU programming and rail bring-up",
        "Project: Alpha controller",
        "Notes: Keep with the Rev A bring-up kit.",
        ""
      ].join("\n"),
      "utf8"
    );

    const jsonHardwareFolderPath = path.join(sandbox.root, "ALPHA", "hardware", "PCA-2003");
    await mkdir(jsonHardwareFolderPath, { recursive: true });
    await writeFile(
      path.join(jsonHardwareFolderPath, "pca.json"),
      JSON.stringify({
        attachedProject: "Alpha controller",
        connectsTo: "Load bank cable",
        notes: "Stored as JSON metadata.",
        tests: "Current-limit sweep"
      }),
      "utf8"
    );

    const fixtureFolderPath = path.join(sandbox.root, "ALPHA", "hardware", "FIXTURE_7");
    await mkdir(fixtureFolderPath, { recursive: true });
    await writeFile(
      path.join(fixtureFolderPath, "info.md"),
      [
        "# FIXTURE-7",
        "",
        "DUT: sensor pod mezzanine",
        "Validates: charge-path brownout behavior",
        "Program: Alpha lab bring-up",
        ""
      ].join("\n"),
      "utf8"
    );

    await mkdir(path.join(sandbox.root, "ALPHA", "hardware", "PTA-ABC"), { recursive: true });
    await mkdir(path.join(sandbox.root, "ALPHA", "hardware", "XYZ-board"), { recursive: true });

    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });
    assert.equal(response.availability, "configured");
    assert.ok(response.customHardware);
    assert.ok(response.customHardware.hardwareFolderPath.endsWith(path.join("ALPHA", "hardware")));
    assert.deepEqual(response.customHardware.recognizedPrefixes, ["FIXTURE", "ICD", "PCA", "PTA"]);
    assert.deepEqual(
      response.customHardware.records.map((record) => record.partNumber),
      ["FIXTURE-7", "ICD-10", "PTA-1001", "PCA-2002", "PCA-2003"]
    );

    const discoveredFolderBacked = response.customHardware.records.find((record) => record.partNumber === "FIXTURE-7");
    assert.ok(discoveredFolderBacked);
    assert.equal(discoveredFolderBacked.folderState, "folder_backed");
    assert.equal(discoveredFolderBacked.folderName, "FIXTURE_7");
    assert.equal(discoveredFolderBacked.connectsTo, "sensor pod mezzanine");
    assert.equal(discoveredFolderBacked.tests, "charge-path brownout behavior");
    assert.equal(discoveredFolderBacked.attachedProject, "Alpha lab bring-up");
    assert.deepEqual(discoveredFolderBacked.mentionedInPartsListFiles, ["alpha-bom.csv"]);

    const folderBacked = response.customHardware.records.find((record) => record.partNumber === "PTA-1001");
    assert.ok(folderBacked);
    assert.equal(folderBacked.folderState, "folder_backed");
    assert.equal(folderBacked.connectsTo, "J1 battery harness and SWD pogo header");
    assert.equal(folderBacked.tests, "MCU programming and rail bring-up");
    assert.equal(folderBacked.attachedProject, "Alpha controller");
    assert.equal(folderBacked.notes, "Keep with the Rev A bring-up kit.");
    assert.equal(folderBacked.metadataSource, "README.md");
    assert.deepEqual(folderBacked.mentionedInPartsListFiles, ["alpha-bom.csv"]);

    const partsListOnly = response.customHardware.records.find((record) => record.partNumber === "PCA-2002");
    assert.ok(partsListOnly);
    assert.equal(partsListOnly.folderState, "parts_list_reference_only");
    assert.equal(partsListOnly.absolutePath, null);
    assert.equal(partsListOnly.connectsTo, null);
    assert.deepEqual(partsListOnly.mentionedInPartsListFiles, ["alpha-bom.csv"]);

    const jsonBacked = response.customHardware.records.find((record) => record.partNumber === "PCA-2003");
    assert.ok(jsonBacked);
    assert.equal(jsonBacked.connectsTo, "Load bank cable");
    assert.equal(jsonBacked.tests, "Current-limit sweep");
    assert.equal(jsonBacked.metadataSource, "pca.json");
  } finally {
    await sandbox.restore();
  }
});

test("buildProjectFilesResponse combines configured prefixes with discovered design folders", async () => {
  const sandbox = await withSandboxRoot();
  const previousPrefixes = process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES;
  process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES = "JIG";

  try {
    const partsListPath = path.join(sandbox.root, "ALPHA", "parts-list");
    await mkdir(partsListPath, { recursive: true });
    await writeFile(path.join(partsListPath, "alpha-bom.csv"), "MPN\nJIG-77\nPTA-1001\nPCA-99\n", "utf8");

    const jigFolderPath = path.join(sandbox.root, "ALPHA", "hardware", "JIG-77");
    await mkdir(jigFolderPath, { recursive: true });
    await writeFile(path.join(jigFolderPath, "hardware.json"), JSON.stringify({ tests: "Configured prefix scan" }), "utf8");
    await mkdir(path.join(sandbox.root, "ALPHA", "hardware", "PTA-1001"), { recursive: true });

    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });
    assert.ok(response.customHardware);
    assert.deepEqual(response.customHardware.recognizedPrefixes, ["JIG", "PTA"]);
    assert.deepEqual(
      response.customHardware.records.map((record) => record.partNumber),
      ["JIG-77", "PTA-1001"]
    );
    assert.equal(response.customHardware.records[0]?.tests, "Configured prefix scan");
    assert.deepEqual(response.customHardware.records[1]?.mentionedInPartsListFiles, ["alpha-bom.csv"]);
  } finally {
    if (previousPrefixes === undefined) {
      delete process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES;
    } else {
      process.env.EE_LIBRARY_CUSTOM_HARDWARE_PREFIXES = previousPrefixes;
    }
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

test("PROJECT_FOLDER_DEFINITIONS includes the hardware and notes categories", () => {
  const categories = PROJECT_FOLDER_DEFINITIONS.map((folder) => folder.category);
  assert.deepEqual(categories, ["parts_list", "hardware", "datasheets", "models", "footprints", "notes"]);
});

test("resolveProjectFolderCategory rejects unknown categories", () => {
  assert.equal(resolveProjectFolderCategory("notes"), "notes");
  assert.equal(resolveProjectFolderCategory("hardware"), "hardware");
  assert.equal(resolveProjectFolderCategory("datasheets"), "datasheets");
  assert.equal(resolveProjectFolderCategory("footprints"), "footprints");
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
  const previousSettingsPath = process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
  const settingsRoot = await mkdtemp(path.join(tmpdir(), "ee-project-files-settings-"));
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";
  process.env.EE_LIBRARY_SITE_SETTINGS_PATH = path.join(settingsRoot, "site-settings.json");

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
    if (previousSettingsPath === undefined) {
      delete process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
    } else {
      process.env.EE_LIBRARY_SITE_SETTINGS_PATH = previousSettingsPath;
    }
    await rm(settingsRoot, { recursive: true, force: true });
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
