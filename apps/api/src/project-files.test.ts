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
  applyProjectDocumentExtractions,
  buildProjectFilesResponse,
  copyProjectDocumentToSuggestedFolder,
  getCustomHardwarePrefixes,
  getProjectFilesRoot,
  resolveProjectFolderCategory,
  sanitizeProjectKey,
  sanitizeUploadFilename,
  saveProjectFile,
  searchProjectDocumentsForWhereUsed,
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
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";

  try {
    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });
    assert.equal(response.availability, "not_configured");
    assert.equal(response.rootPath, null);
    assert.deepEqual(response.folders, []);
    assert.equal(response.message, null);
    assert.equal(response.customHardware, null);
    assert.equal(response.documentMap, null);
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

test("buildProjectFilesResponse maps messy project folders into document sorting hints", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const messyTestPath = path.join(sandbox.root, "ALPHA", "Bob-drop", "old-tests");
    await mkdir(messyTestPath, { recursive: true });
    await writeFile(
      path.join(messyTestPath, "J202-test-procedure-rev-d.md"),
      [
        "# J202 Test Procedure",
        "",
        "Revision: Rev D",
        "Connector J202 pin 47 carries RS422_TX+.",
        "Use with TFX-DEMO-PMC-BRINGUP only after review.",
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(messyTestPath, "J202-atp-run-sheet-rev-d.txt"),
      [
        "Acceptance test procedure for connector J202.",
        "Revision: Rev D",
        "Check pin 48 before energizing the RS422_TX- pair.",
        ""
      ].join("\n"),
      "utf8"
    );

    const cablePath = path.join(sandbox.root, "ALPHA", "hardware", "CAB-DEMO-PMC-JST-PWR");
    await mkdir(cablePath, { recursive: true });
    await writeFile(
      path.join(cablePath, "CAB-DEMO-PMC-JST-PWR-pinout.csv"),
      "Cable,Revision,Connector Ref,Pin,Signal\nCAB-DEMO-PMC-JST-PWR,R0.2,J202,47,RS422_TX+\n",
      "utf8"
    );

    const unknownPath = path.join(sandbox.root, "ALPHA", "random");
    await mkdir(unknownPath, { recursive: true });
    await writeFile(path.join(unknownPath, "notes-from-bob.tmp"), "ask Bob", "utf8");

    const networkDumpPath = path.join(sandbox.root, "ALPHA", "network-drive-dump", "rev-c");
    await mkdir(networkDumpPath, { recursive: true });
    await writeFile(
      path.join(networkDumpPath, "PMC-requirements-rev-c.txt"),
      "Requirements Rev C\nThe unit shall keep startup current below 500 mA.\nThe unit shall log brownout events during bring-up.\n",
      "utf8"
    );
    await writeFile(
      path.join(networkDumpPath, "J202-cable-pinout-rev-c.csv"),
      "Cable,Revision,Connector Ref,Pin,Signal\nCAB-DEMO-PMC-JST-PWR,Rev C,J202,47,RS422_TX+\n",
      "utf8"
    );

    const response = await buildProjectFilesResponse({ id: "project-alpha", projectKey: "ALPHA" });

    assert.equal(response.availability, "configured");
    assert.ok(response.documentMap);
    assert.equal(response.documentMap.summary.documentCount, 6);
    assert.equal(response.documentMap.summary.folderPatternCount, 2);
    assert.equal(response.documentMap.summary.mixedFolderCount, 1);
    assert.equal(response.documentMap.summary.outsideStandardFolderCount, 5);
    assert.equal(response.documentMap.summary.connectorMentionCount, 4);
    assert.equal(response.documentMap.summary.pinMentionCount, 4);
    assert.equal(response.documentMap.summary.moveSuggestionCount, 4);
    assert.equal(response.documentMap.summary.unknownDocumentCount, 1);

    const testFolderPattern = response.documentMap.folderPatterns.find((pattern) => pattern.folderPath === "Bob-drop/old-tests");
    assert.ok(testFolderPattern);
    assert.equal(testFolderPattern.dominantDocumentType, "test_procedure");
    assert.equal(testFolderPattern.fileCount, 2);
    assert.equal(testFolderPattern.suggestedCategory, "notes");
    assert.equal(testFolderPattern.suggestedAction, "use_file_copy_buttons");
    assert.deepEqual(testFolderPattern.signals.connectorRefs, ["J202"]);
    assert.deepEqual(testFolderPattern.signals.pinRefs, ["47", "48"]);
    assert.ok(testFolderPattern.exampleFilenames.includes("J202-test-procedure-rev-d.md"));

    const mixedFolderPattern = response.documentMap.folderPatterns.find((pattern) => pattern.folderPath === "network-drive-dump/rev-c");
    assert.ok(mixedFolderPattern);
    assert.equal(mixedFolderPattern.suggestedAction, "sort_each_file");
    assert.equal(mixedFolderPattern.fileCount, 2);
    assert.equal(mixedFolderPattern.typeCounts.some((entry) => entry.documentType === "requirements"), true);
    assert.equal(mixedFolderPattern.typeCounts.some((entry) => entry.documentType === "pinout"), true);

    const testProcedure = response.documentMap.documents.find((entry) => entry.filename === "J202-test-procedure-rev-d.md");
    assert.ok(testProcedure);
    assert.equal(testProcedure.documentType, "test_procedure");
    assert.equal(testProcedure.outsideStandardFolders, true);
    assert.equal(testProcedure.suggestedCategory, "notes");
    assert.deepEqual(testProcedure.signals.connectorRefs, ["J202"]);
    assert.deepEqual(testProcedure.signals.pinRefs, ["47"]);
    assert.deepEqual(testProcedure.signals.revisionLabels, ["Rev D"]);
    assert.ok(testProcedure.signals.signalNames.includes("RS422_TX+"));
    assert.equal(testProcedure.sortPlan.action, "move_to_standard_folder");
    assert.equal(testProcedure.sortPlan.targetCategory, "notes");
    assert.equal(testProcedure.sortPlan.targetRelativePath, "notes/J202-test-procedure-rev-d.md");

    const pinout = response.documentMap.documents.find((entry) => entry.filename === "CAB-DEMO-PMC-JST-PWR-pinout.csv");
    assert.ok(pinout);
    assert.equal(pinout.documentType, "pinout");
    assert.equal(pinout.currentCategory, "hardware");
    assert.equal(pinout.outsideStandardFolders, false);
    assert.deepEqual(pinout.signals.cableKeys, ["CAB-DEMO-PMC-JST-PWR"]);
    assert.deepEqual(pinout.signals.pinRefs, ["47"]);
    assert.equal(pinout.sortPlan.action, "leave_in_place");
    assert.equal(pinout.sortPlan.targetRelativePath, "hardware/CAB-DEMO-PMC-JST-PWR/CAB-DEMO-PMC-JST-PWR-pinout.csv");

    const unknown = response.documentMap.documents.find((entry) => entry.filename === "notes-from-bob.tmp");
    assert.ok(unknown);
    assert.equal(unknown.documentType, "unknown");
    assert.equal(unknown.needsAttention, true);
    assert.equal(unknown.sortPlan.action, "review_unknown");
    assert.equal(unknown.sortPlan.targetRelativePath, null);
  } finally {
    await sandbox.restore();
  }
});

test("copyProjectDocumentToSuggestedFolder copies a current sort suggestion without moving the source", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const messyTestPath = path.join(sandbox.root, "ALPHA", "Bob-drop", "old-tests");
    await mkdir(messyTestPath, { recursive: true });
    await writeFile(
      path.join(messyTestPath, "J202-test-procedure-rev-d.md"),
      "Revision: Rev D\nConnector J202 pin 47 carries RS422_TX+.\nTest procedure for TFX-DEMO-PMC-BRINGUP.\n",
      "utf8"
    );

    const project = { id: "project-alpha", projectKey: "ALPHA" };
    const firstCopy = await copyProjectDocumentToSuggestedFolder(project, {
      sourceRelativePath: "Bob-drop/old-tests/J202-test-procedure-rev-d.md"
    });

    assert.equal(firstCopy.status, "ok");
    assert.equal(firstCopy.response.sourceRelativePath, "Bob-drop/old-tests/J202-test-procedure-rev-d.md");
    assert.equal(firstCopy.response.suggestedRelativePath, "notes/J202-test-procedure-rev-d.md");
    assert.equal(firstCopy.response.targetRelativePath, "notes/J202-test-procedure-rev-d.md");
    assert.equal(firstCopy.response.targetCategory, "notes");
    assert.match(firstCopy.response.boundary, /original file was left in place/u);

    const copiedContent = await readFile(path.join(sandbox.root, "ALPHA", "notes", "J202-test-procedure-rev-d.md"), "utf8");
    const sourceContent = await readFile(path.join(messyTestPath, "J202-test-procedure-rev-d.md"), "utf8");
    assert.equal(copiedContent, sourceContent);

    const secondCopy = await copyProjectDocumentToSuggestedFolder(project, {
      sourceRelativePath: "Bob-drop/old-tests/J202-test-procedure-rev-d.md"
    });
    assert.equal(secondCopy.status, "ok");
    assert.equal(secondCopy.response.targetRelativePath, "notes/J202-test-procedure-rev-d-1.md");
  } finally {
    await sandbox.restore();
  }
});

test("copyProjectDocumentToSuggestedFolder refuses rows without a standard-folder copy suggestion", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const hardwarePath = path.join(sandbox.root, "ALPHA", "hardware", "CAB-DEMO-PMC-JST-PWR");
    await mkdir(hardwarePath, { recursive: true });
    await writeFile(
      path.join(hardwarePath, "CAB-DEMO-PMC-JST-PWR-pinout.csv"),
      "Cable,Connector Ref,Pin,Signal\nCAB-DEMO-PMC-JST-PWR,J202,47,RS422_TX+\n",
      "utf8"
    );

    const sortedResult = await copyProjectDocumentToSuggestedFolder(
      { id: "project-alpha", projectKey: "ALPHA" },
      { sourceRelativePath: "hardware/CAB-DEMO-PMC-JST-PWR/CAB-DEMO-PMC-JST-PWR-pinout.csv" }
    );
    assert.equal(sortedResult.status, "not_suggested");

    const missingResult = await copyProjectDocumentToSuggestedFolder(
      { id: "project-alpha", projectKey: "ALPHA" },
      { sourceRelativePath: "../outside.txt" }
    );
    assert.equal(missingResult.status, "not_found");
  } finally {
    await sandbox.restore();
  }
});

test("searchProjectDocumentsForWhereUsed finds natural connector and pin questions", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const messyTestPath = path.join(sandbox.root, "ALPHA", "Bob-drop", "old-tests");
    await mkdir(messyTestPath, { recursive: true });
    await writeFile(
      path.join(messyTestPath, "J202-test-procedure-rev-d.md"),
      "Revision: Rev D\nConnector J202 pin 47 carries RS422_TX+.\nTest procedure for TFX-DEMO-PMC-BRINGUP.\n",
      "utf8"
    );

    const projects = [
      {
        createdAt: "2026-06-16T12:00:00.000Z",
        description: "Area 1 search fixture",
        id: "project-alpha",
        name: "Alpha Controller",
        owner: "hardware",
        projectKey: "ALPHA",
        status: "active" as const,
        updatedAt: "2026-06-16T12:00:00.000Z"
      }
    ];

    const connectorHits = await searchProjectDocumentsForWhereUsed(projects, "Which test procedure uses connector J202?");
    assert.equal(connectorHits.length, 1);
    assert.equal(connectorHits[0]?.project.projectKey, "ALPHA");
    assert.equal(connectorHits[0]?.document.relativePath, "Bob-drop/old-tests/J202-test-procedure-rev-d.md");
    assert.deepEqual(connectorHits[0]?.matchedLabels, ["Connector: J202", "Type: Test procedure"]);

    const pinHits = await searchProjectDocumentsForWhereUsed(projects, "pin 47");
    assert.equal(pinHits.length, 1);
    assert.deepEqual(pinHits[0]?.matchedLabels, ["Pin: 47"]);
  } finally {
    await sandbox.restore();
  }
});

test("extracted PDF text improves document classification and where-used source labels", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const projectFolder = path.join(sandbox.root, "ALPHA", "incoming");
    await mkdir(projectFolder, { recursive: true });
    await writeFile(path.join(projectFolder, "scan-001.pdf"), "%PDF mock bytes", "utf8");

    const rawResponse = await buildProjectFilesResponse({
      id: "project-alpha",
      projectKey: "ALPHA"
    });
    const rawDocument = rawResponse.documentMap?.documents.find(
      (entry) => entry.filename === "scan-001.pdf"
    );
    assert.ok(rawDocument);
    assert.equal(rawDocument.documentType, "unknown");

    const extractedText = [
      "J202 acceptance test procedure",
      "Revision: Rev D",
      "Connector J202 pin 47 carries RS422_TX+.",
      "Use fixture TFX-DEMO-PMC-BRINGUP."
    ].join("\n");
    const extractionRecord = {
      extractedText,
      relativePath: "incoming/scan-001.pdf",
      sourceSegments: [
        {
          label: "Page 4",
          text: extractedText,
          textPreview: "Connector J202 pin 47 carries RS422_TX+."
        }
      ],
      state: {
        completedAt: "2026-06-18T10:01:00.000Z",
        errorCode: null,
        errorMessage: null,
        estimatedWaitSeconds: null,
        extractedCharacterCount: extractedText.length,
        extractorVersion: "project-document-reader-v1",
        format: "pdf" as const,
        progressMessage: "Text ready from 1 source section.",
        progressPercent: 100,
        queuePosition: null,
        searchableTextAvailable: true,
        sourceLocations: [
          {
            label: "Page 4",
            textPreview: "Connector J202 pin 47 carries RS422_TX+."
          }
        ],
        sourceUnitCount: 1,
        startedAt: "2026-06-18T10:00:00.000Z",
        status: "succeeded" as const
      }
    };
    const enrichedResponse = applyProjectDocumentExtractions(rawResponse, [
      extractionRecord
    ]);
    const enrichedDocument = enrichedResponse.documentMap?.documents.find(
      (entry) => entry.filename === "scan-001.pdf"
    );

    assert.ok(enrichedDocument);
    assert.equal(enrichedDocument.documentType, "test_procedure");
    assert.deepEqual(enrichedDocument.signals.connectorRefs, ["J202"]);
    assert.deepEqual(enrichedDocument.signals.pinRefs, ["47"]);
    assert.equal(enrichedDocument.extraction?.status, "succeeded");

    const projects = [
      {
        createdAt: "2026-06-18T09:00:00.000Z",
        description: "",
        id: "project-alpha",
        name: "Alpha",
        owner: null,
        projectKey: "ALPHA",
        status: "prototype" as const,
        updatedAt: "2026-06-18T09:00:00.000Z"
      }
    ];
    const hits = await searchProjectDocumentsForWhereUsed(
      projects,
      "Which test procedure uses connector J202?",
      async () => [extractionRecord]
    );

    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.document.filename, "scan-001.pdf");
    assert.ok(hits[0]?.matchedLabels.includes("Source: Page 4"));
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
  assert.deepEqual(categories, ["parts_list", "hardware", "datasheets", "models", "notes"]);
});

test("resolveProjectFolderCategory rejects unknown categories", () => {
  assert.equal(resolveProjectFolderCategory("notes"), "notes");
  assert.equal(resolveProjectFolderCategory("hardware"), "hardware");
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

test("readProjectBomSourceFile reads csv text and xlsx base64 with mirror-relative provenance", async () => {
  const sandbox = await withSandboxRoot();
  try {
    const { readProjectBomSourceFile } = await import("./project-files");
    const projectRoot = path.join(sandbox.root, "demo-project");
    await mkdir(path.join(projectRoot, "parts-list"), { recursive: true });
    const csvBody = "MPN,Qty\r\nRC0402FR-0710KL,4\r\n";
    await writeFile(path.join(projectRoot, "parts-list", "main.csv"), csvBody, "utf8");
    const xlsxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02, 0x03]);
    await writeFile(path.join(projectRoot, "parts-list", "alt.xlsx"), xlsxBytes);

    const project = { id: "proj-1", projectKey: "demo-project" };
    const csvResult = await readProjectBomSourceFile(project, "parts-list/main.csv");
    assert.equal(csvResult.status, "ok");
    if (csvResult.status === "ok") {
      assert.equal(csvResult.response.sourceFormat, "csv");
      assert.equal(csvResult.response.rawContent, csvBody);
      assert.equal(csvResult.response.sourceFilename, "parts-list/main.csv");
    }

    const xlsxResult = await readProjectBomSourceFile(project, "parts-list/alt.xlsx");
    assert.equal(xlsxResult.status, "ok");
    if (xlsxResult.status === "ok") {
      assert.equal(xlsxResult.response.sourceFormat, "xlsx");
      assert.equal(xlsxResult.response.rawContent, xlsxBytes.toString("base64"));
    }
  } finally {
    await sandbox.restore();
  }
});

test("readProjectBomSourceFile refuses traversal, legacy formats, and reports missing files honestly", async () => {
  const sandbox = await withSandboxRoot();
  try {
    const { readProjectBomSourceFile } = await import("./project-files");
    const projectRoot = path.join(sandbox.root, "demo-project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(sandbox.root, "outside.csv"), "MPN\nX\n", "utf8");
    const project = { id: "proj-1", projectKey: "demo-project" };

    const traversal = await readProjectBomSourceFile(project, "../outside.csv");
    assert.equal(traversal.status, "invalid_source");

    const legacy = await readProjectBomSourceFile(project, "old-bom.xls");
    assert.equal(legacy.status, "unsupported");
    if (legacy.status === "unsupported") {
      assert.match(legacy.message, /\.xlsx/u);
    }

    const wrongType = await readProjectBomSourceFile(project, "notes/readme.pdf");
    assert.equal(wrongType.status, "unsupported");

    const missing = await readProjectBomSourceFile(project, "parts-list/not-there.csv");
    assert.equal(missing.status, "not_found");
  } finally {
    await sandbox.restore();
  }
});

test("readProjectBomSourceFile reports not_configured when the mirror is disabled", async () => {
  const previous = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  try {
    process.env.EE_LIBRARY_PROJECT_FILES_ROOT = "off";
    const { readProjectBomSourceFile } = await import("./project-files");
    const result = await readProjectBomSourceFile({ id: "proj-1", projectKey: "demo-project" }, "parts-list/main.csv");
    assert.equal(result.status, "not_configured");
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
    } else {
      process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previous;
    }
  }
});

test("scanUnimportedProjectFolders lists unclaimed folders with parts-list candidates and skips claimed ones case-insensitively", async () => {
  const sandbox = await withSandboxRoot();
  try {
    const { scanUnimportedProjectFolders } = await import("./project-files");
    await mkdir(path.join(sandbox.root, "OLD-SENSOR", "docs"), { recursive: true });
    await writeFile(path.join(sandbox.root, "OLD-SENSOR", "sensor-bom.csv"), "MPN,Qty\nRC0402FR-0710KL,4\n", "utf8");
    await writeFile(path.join(sandbox.root, "OLD-SENSOR", "docs", "notes.txt"), "bring-up notes", "utf8");
    await mkdir(path.join(sandbox.root, "my_board 2022"), { recursive: true });
    await mkdir(path.join(sandbox.root, "demo-pocket-mcu"), { recursive: true });
    await mkdir(path.join(sandbox.root, ".hidden"), { recursive: true });

    const result = await scanUnimportedProjectFolders(["DEMO-POCKET-MCU"]);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }

    const names = result.response.unimportedFolders.map((entry) => entry.folderName);
    assert.deepEqual([...names].sort(), ["OLD-SENSOR", "my_board 2022"].sort(), "claimed and hidden folders are excluded");
    assert.equal(result.response.skippedExistingCount, 1);

    const sensor = result.response.unimportedFolders.find((entry) => entry.folderName === "OLD-SENSOR");
    assert.equal(sensor?.renameTarget, "OLD-SENSOR", "already key-form folders need no rename");
    assert.equal(sensor?.bestPartsListRelativePath, "sensor-bom.csv");
    assert.ok((sensor?.partsListCandidates[0]?.confidenceScore ?? 0) > 0.5);

    const board = result.response.unimportedFolders.find((entry) => entry.folderName === "my_board 2022");
    assert.equal(board?.renameTarget, "MY_BOARD-2022", "rename target is the sanitized normalized key form");
    assert.equal(board?.bestPartsListRelativePath, null);
  } finally {
    await sandbox.restore();
  }
});

test("renameFolderForOnboarding renames to key form, no-ops when already there, and refuses collisions and traversal", async () => {
  const sandbox = await withSandboxRoot();
  try {
    const { renameFolderForOnboarding } = await import("./project-files");
    await mkdir(path.join(sandbox.root, "my_board 2022"), { recursive: true });
    await mkdir(path.join(sandbox.root, "ALREADY-KEYED"), { recursive: true });
    await mkdir(path.join(sandbox.root, "taken source"), { recursive: true });
    await mkdir(path.join(sandbox.root, "TAKEN-SOURCE"), { recursive: true });

    const renamed = await renameFolderForOnboarding("my_board 2022");
    assert.deepEqual(renamed, { renamed: true, renamedTo: "MY_BOARD-2022", status: "ok" });
    const renamedInfo = await import("node:fs/promises").then((fs) => fs.stat(path.join(sandbox.root, "MY_BOARD-2022")));
    assert.ok(renamedInfo.isDirectory());

    const noop = await renameFolderForOnboarding("ALREADY-KEYED");
    assert.deepEqual(noop, { renamed: false, renamedTo: "ALREADY-KEYED", status: "ok" });

    const collision = await renameFolderForOnboarding("taken source");
    assert.equal(collision.status, "collision");

    const traversal = await renameFolderForOnboarding("../outside");
    assert.equal(traversal.status, "invalid_source");

    const missing = await renameFolderForOnboarding("never-existed");
    assert.equal(missing.status, "invalid_source");
  } finally {
    await sandbox.restore();
  }
});
