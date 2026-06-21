/**
 * File header: Tests the project file mirror UI for custom design records.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filterProjectDocumentMapEntries,
  mergeProjectDocumentExtractionStatuses,
  ProjectFilesPanel
} from "./ProjectFilesPanel";
import type { ProjectFilesResponse } from "@ee-library/shared/types";

/**
 * Verifies folder-backed and parts-list-only design records render without implying that
 * missing note fields are known.
 */
test("ProjectFilesPanel renders custom design notes, summary counts, and missing-note states", () => {
  const html = renderToStaticMarkup(<ProjectFilesPanel projectId="project-alpha" files={buildProjectFilesResponse()} />);

  assert.match(html, /Custom designs/u);
  assert.match(html, /Re-entry brief/u);
  assert.match(html, /PDF review/u);
  assert.match(html, /3 PDFs/u);
  assert.match(html, /1 saved review note/u);
  assert.match(html, /Saved review notes/u);
  assert.match(html, /review-alpha-drawing-old\.md/u);
  assert.match(html, /Capture red notes/u);
  assert.match(html, /Datasheets - alpha-drawing.pdf/u);
  assert.match(html, /Notes - prior-review.pdf/u);
  assert.match(html, /Review category/u);
  assert.match(html, /Reviewer/u);
  assert.match(html, /Page \/ sheet \/ area/u);
  assert.match(html, /Correction owner/u);
  assert.match(html, /Red note/u);
  assert.match(html, /Requested correction/u);
  assert.match(html, /Stale review/u);
  assert.match(html, /Stale file set/u);
  assert.match(html, /Latest file activity/u);
  assert.match(html, /File entries.*6/u);
  assert.match(html, /Folders with files.*4\/5/u);
  assert.match(html, /Empty folders.*3D models/u);
  assert.match(html, /Document map/u);
  assert.match(html, /Find a mapped file/u);
  assert.match(html, /Needs sorting.*3/u);
  assert.match(html, /Looks sorted.*1/u);
  assert.match(html, /Folder trends.*1 pattern/u);
  assert.match(html, /This map uses filenames, small text files, and completed PDF or Office reading as hints/u);
  assert.match(html, /Files mapped.*4/u);
  assert.match(html, /Needs sorting.*3/u);
  assert.match(html, /Move suggestions.*2/u);
  assert.match(html, /Folder trends.*1/u);
  assert.match(html, /Mixed folders.*0/u);
  assert.match(html, /Outside folders.*3/u);
  assert.match(html, /Connector refs.*3/u);
  assert.match(html, /Pin refs.*3/u);
  assert.match(html, /Folder trends/u);
  assert.match(html, /pattern found from folder names and file mixes/u);
  assert.match(html, /Mostly test procedures/u);
  assert.match(html, /Use file copy buttons for Notes/u);
  assert.match(html, /Reading 1 document in the background/u);
  assert.match(html, /Large PDFs and workbooks can take a few minutes/u);
  assert.match(html, /Text ready.*1/u);
  assert.match(html, /Reading.*1/u);
  assert.match(html, /3 pages/u);
  assert.match(html, /3,842 searchable characters/u);
  assert.match(html, /Page 2/u);
  assert.match(html, /Queue position 2/u);
  assert.match(html, /Approximately 2 minutes remaining/u);
  assert.match(html, /J202-atp-run-sheet-rev-d\.docx/u);
  assert.match(html, /J202-test-procedure-rev-d\.pdf/u);
  assert.match(html, /Test procedure/u);
  assert.match(html, /Connectors: J202/u);
  assert.match(html, /Pins: 47/u);
  assert.match(html, /Revisions: Rev D/u);
  assert.match(html, /Suggested place/u);
  assert.match(html, /Move to Notes/u);
  assert.match(html, /Put at:.*notes\/J202-test-procedure-rev-d\.pdf/u);
  assert.match(html, /Copy to suggested folder/u);
  assert.match(html, /Leave here/u);
  assert.match(html, /Open and sort/u);
  assert.match(html, /Now: Bob-drop\/old-tests/u);
  assert.match(html, /Recognized families: ICD, PCA, PTA/u);
  assert.match(html, /Records.*2/u);
  assert.match(html, /Folders.*1/u);
  assert.match(html, /Parts-list only.*1/u);
  assert.match(html, /Documented.*1/u);
  assert.match(html, /Needs notes.*1/u);
  assert.match(html, /PTA-1001/u);
  assert.match(html, /PCA-2001/u);
  assert.match(html, /J1 battery harness/u);
  assert.match(html, /MCU programming/u);
  assert.match(html, /Complete/u);
  assert.match(html, /0\/3 fields/u);
  assert.match(html, /Missing: connects to, validates, project/u);
  assert.match(html, /Folder:.*PTA-1001/u);
  assert.match(html, /Note:.*README\.md/u);
  assert.match(html, /Parts list: alpha-bom\.csv/u);
  assert.match(html, /parts-list only/u);
  assert.match(html, /No design folder/u);
  assert.match(html, /Not recorded/u);
});

test("document map filters by engineering clues and review scope", () => {
  const files = buildProjectFilesResponse();
  const documents = files.documentMap?.documents ?? [];
  const connectorMatches = filterProjectDocumentMapEntries(documents, "J202", "all");
  const pinMatches = filterProjectDocumentMapEntries(documents, "pin 47", "all");
  const attentionMatches = filterProjectDocumentMapEntries(documents, "", "attention");
  const readyMatches = filterProjectDocumentMapEntries(documents, "", "ready");

  assert.equal(connectorMatches.length, 3);
  assert.equal(pinMatches.length, 2);
  assert.equal(attentionMatches.length, 3);
  assert.equal(readyMatches.length, 1);
  assert.equal(readyMatches[0]?.filename, "CAB-DEMO-PMC-JST-PWR-pinout.csv");
});

test("ProjectFilesPanel renders running, failed, and legacy document-reader recovery states", () => {
  const files = buildProjectFilesResponse();
  const documentMap = files.documentMap;
  assert.ok(documentMap);
  const sourceDocuments = documentMap.documents;
  const runningSource = sourceDocuments[0];
  const failedSource = sourceDocuments[1];
  const unsupportedSource = sourceDocuments[2];
  assert.ok(runningSource);
  assert.ok(failedSource);
  assert.ok(unsupportedSource);

  documentMap.documents = [
    {
      ...runningSource,
      extraction: {
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        estimatedWaitSeconds: 18,
        extractedCharacterCount: 0,
        extractorVersion: "project-document-reader-v1",
        format: "pdf",
        progressMessage: "Reading page 4 of 10.",
        progressPercent: 42,
        queuePosition: null,
        searchableTextAvailable: false,
        sourceLocations: [],
        sourceUnitCount: 10,
        startedAt: "2026-06-19T10:00:00.000Z",
        status: "running"
      },
      filename: "running-procedure.pdf",
      relativePath: "incoming/running-procedure.pdf"
    },
    {
      ...failedSource,
      extraction: {
        completedAt: "2026-06-19T10:01:00.000Z",
        errorCode: "NO_SEARCHABLE_TEXT",
        errorMessage: "No selectable text was found. This may be a scanned PDF.",
        estimatedWaitSeconds: null,
        extractedCharacterCount: 0,
        extractorVersion: "project-document-reader-v1",
        format: "pdf",
        progressMessage: "The document reader could not finish this file.",
        progressPercent: 25,
        queuePosition: null,
        searchableTextAvailable: false,
        sourceLocations: [],
        sourceUnitCount: null,
        startedAt: "2026-06-19T10:00:00.000Z",
        status: "failed"
      },
      filename: "scanned-procedure.pdf",
      relativePath: "incoming/scanned-procedure.pdf"
    },
    {
      ...unsupportedSource,
      extraction: {
        completedAt: null,
        errorCode: "LEGACY_OFFICE_FORMAT",
        errorMessage: "Save this file as DOCX, XLSX, or PPTX so the document reader can open it.",
        estimatedWaitSeconds: null,
        extractedCharacterCount: 0,
        extractorVersion: "project-document-reader-v1",
        format: "docx",
        progressMessage: "This older Office file needs conversion before it can be read.",
        progressPercent: 0,
        queuePosition: null,
        searchableTextAvailable: false,
        sourceLocations: [],
        sourceUnitCount: null,
        startedAt: null,
        status: "unsupported"
      },
      filename: "legacy-procedure.doc",
      relativePath: "incoming/legacy-procedure.doc"
    }
  ];
  documentMap.summary = {
    ...documentMap.summary,
    documentCount: 3,
    extractionFailedCount: 1,
    extractionQueuedCount: 0,
    extractionRunningCount: 1,
    extractionSucceededCount: 0,
    extractionUnsupportedCount: 1
  };

  const html = renderToStaticMarkup(
    <ProjectFilesPanel projectId="project-alpha" files={files} />
  );

  assert.match(html, /Reading 1 document in the background/u);
  assert.match(html, /Large PDFs and workbooks can take a few minutes/u);
  assert.match(html, /42% read/u);
  assert.match(html, /Usually under a minute/u);
  assert.match(html, /Read failed.*1/u);
  assert.match(html, /No selectable text was found/u);
  assert.match(html, /Retry/u);
  assert.match(html, /Needs newer file format/u);
  assert.match(html, /Save this file as DOCX, XLSX, or PPTX/u);
});

test("document-reader polling merges progress without discarding completed source locations", () => {
  const files = buildProjectFilesResponse();
  const completedPath = files.documentMap?.documents[0]?.relativePath;
  const queuedPath = files.documentMap?.documents[1]?.relativePath;
  assert.ok(completedPath);
  assert.ok(queuedPath);

  const merged = mergeProjectDocumentExtractionStatuses(files, [
    {
      extraction: {
        completedAt: "2026-06-19T10:01:00.000Z",
        errorCode: null,
        errorMessage: null,
        estimatedWaitSeconds: null,
        extractedCharacterCount: 3842,
        extractorVersion: "project-document-reader-v1",
        format: "pdf",
        progressMessage: "Text ready from 3 source sections.",
        progressPercent: 100,
        queuePosition: null,
        searchableTextAvailable: true,
        sourceLocations: [],
        sourceUnitCount: 3,
        startedAt: "2026-06-19T10:00:00.000Z",
        status: "succeeded"
      },
      relativePath: completedPath
    },
    {
      extraction: {
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        estimatedWaitSeconds: 12,
        extractedCharacterCount: 0,
        extractorVersion: "project-document-reader-v1",
        format: "docx",
        progressMessage: "Reading Word document paragraphs.",
        progressPercent: 45,
        queuePosition: null,
        searchableTextAvailable: false,
        sourceLocations: [],
        sourceUnitCount: null,
        startedAt: "2026-06-19T10:00:00.000Z",
        status: "running"
      },
      relativePath: queuedPath
    }
  ]);
  const completedDocument = merged.documentMap?.documents.find(
    (document) => document.relativePath === completedPath
  );
  const runningDocument = merged.documentMap?.documents.find(
    (document) => document.relativePath === queuedPath
  );

  assert.equal(completedDocument?.extraction?.sourceLocations[0]?.label, "Page 2");
  assert.equal(runningDocument?.extraction?.status, "running");
  assert.equal(runningDocument?.extraction?.progressPercent, 45);
  assert.equal(merged.documentMap?.summary.extractionQueuedCount, 0);
  assert.equal(merged.documentMap?.summary.extractionRunningCount, 1);
  assert.equal(merged.documentMap?.summary.extractionSucceededCount, 1);
});

/**
 * Builds a configured file mirror payload with two custom design records.
 */
function buildProjectFilesResponse(): ProjectFilesResponse {
  return {
    availability: "configured",
    customHardware: {
      boundary: "Custom design notes are records only.",
      hardwareFolderPath: "C:\\EE-Library\\projects\\ALPHA\\hardware",
      recognizedPrefixes: ["ICD", "PCA", "PTA"],
      records: [
        {
          absolutePath: "C:\\EE-Library\\projects\\ALPHA\\hardware\\PTA-1001",
          attachedProject: "Alpha controller",
          connectsTo: "J1 battery harness",
          folderName: "PTA-1001",
          folderState: "folder_backed",
          mentionedInPartsListFiles: ["alpha-bom.csv"],
          metadataSource: "README.md",
          modifiedAt: "2025-01-05T12:00:00.000Z",
          notes: "Keep with the Rev A bring-up kit.",
          partNumber: "PTA-1001",
          tests: "MCU programming"
        },
        {
          absolutePath: null,
          attachedProject: null,
          connectsTo: null,
          folderName: null,
          folderState: "parts_list_reference_only",
          mentionedInPartsListFiles: ["alpha-bom.csv"],
          metadataSource: null,
          modifiedAt: null,
          notes: null,
          partNumber: "PCA-2001",
          tests: null
        }
      ]
    },
    documentMap: {
      boundary: "This map uses filenames, small text files, and completed PDF or Office reading as hints. A listed document has not been reviewed, approved, or checked for reuse.",
      documents: [
        {
          confidenceScore: 0.86,
          currentCategory: null,
          documentType: "test_procedure",
          extraction: {
            completedAt: "2025-01-07T12:02:00.000Z",
            errorCode: null,
            errorMessage: null,
            estimatedWaitSeconds: null,
            extractedCharacterCount: 3842,
            extractorVersion: "project-document-reader-v1",
            format: "pdf",
            progressMessage: "Text ready from 3 source sections.",
            progressPercent: 100,
            queuePosition: null,
            searchableTextAvailable: true,
            sourceLocations: [
              {
                label: "Page 2",
                textPreview: "Connector J202 pin 47 carries RS422_TX+ during the bring-up test."
              }
            ],
            sourceUnitCount: 3,
            startedAt: "2025-01-07T12:00:00.000Z",
            status: "succeeded"
          },
          filename: "J202-test-procedure-rev-d.pdf",
          id: "doc-bob-drop-old-tests-j202-test-procedure-rev-d-md",
          modifiedAt: "2025-01-07T12:00:00.000Z",
          needsAttention: true,
          outsideStandardFolders: true,
          parentFolder: "Bob-drop/old-tests",
          reason: "Test procedure wording found.",
          relativePath: "Bob-drop/old-tests/J202-test-procedure-rev-d.pdf",
          signals: {
            cableKeys: [],
            connectorRefs: ["J202"],
            fixtureKeys: [],
            pinRefs: ["47"],
            revisionLabels: ["Rev D"],
            signalNames: ["RS422_TX+"]
          },
          sizeBytes: 1200,
          sortPlan: {
            action: "move_to_standard_folder",
            reason: "This looks like a test procedure outside the standard folders.",
            sourceRelativePath: "Bob-drop/old-tests/J202-test-procedure-rev-d.pdf",
            targetCategory: "notes",
            targetFolderLabel: "Notes",
            targetRelativePath: "notes/J202-test-procedure-rev-d.pdf"
          },
          suggestedCategory: "notes"
        },
        {
          confidenceScore: 0.91,
          currentCategory: null,
          documentType: "test_procedure",
          extraction: {
            completedAt: null,
            errorCode: null,
            errorMessage: null,
            estimatedWaitSeconds: 75,
            extractedCharacterCount: 0,
            extractorVersion: "project-document-reader-v1",
            format: "docx",
            progressMessage: "Waiting for the document reader.",
            progressPercent: 0,
            queuePosition: 2,
            searchableTextAvailable: false,
            sourceLocations: [],
            sourceUnitCount: null,
            startedAt: null,
            status: "queued"
          },
          filename: "J202-atp-run-sheet-rev-d.docx",
          id: "doc-bob-drop-old-tests-j202-atp-run-sheet-rev-d-txt",
          modifiedAt: "2025-01-07T12:30:00.000Z",
          needsAttention: true,
          outsideStandardFolders: true,
          parentFolder: "Bob-drop/old-tests",
          reason: "Test procedure wording found.",
          relativePath: "Bob-drop/old-tests/J202-atp-run-sheet-rev-d.docx",
          signals: {
            cableKeys: [],
            connectorRefs: ["J202"],
            fixtureKeys: [],
            pinRefs: ["48"],
            revisionLabels: ["Rev D"],
            signalNames: ["RS422_TX-"]
          },
          sizeBytes: 980,
          sortPlan: {
            action: "move_to_standard_folder",
            reason: "This looks like a test procedure outside the standard folders.",
            sourceRelativePath: "Bob-drop/old-tests/J202-atp-run-sheet-rev-d.docx",
            targetCategory: "notes",
            targetFolderLabel: "Notes",
            targetRelativePath: "notes/J202-atp-run-sheet-rev-d.docx"
          },
          suggestedCategory: "notes"
        },
        {
          confidenceScore: 0.9,
          currentCategory: "hardware",
          documentType: "pinout",
          extraction: null,
          filename: "CAB-DEMO-PMC-JST-PWR-pinout.csv",
          id: "doc-hardware-cab-demo-pmc-jst-pwr-pinout-csv",
          modifiedAt: "2025-01-06T12:00:00.000Z",
          needsAttention: false,
          outsideStandardFolders: false,
          parentFolder: "hardware/CAB-DEMO-PMC-JST-PWR",
          reason: "Connector and pin wording found.",
          relativePath: "hardware/CAB-DEMO-PMC-JST-PWR/CAB-DEMO-PMC-JST-PWR-pinout.csv",
          signals: {
            cableKeys: ["CAB-DEMO-PMC-JST-PWR"],
            connectorRefs: ["J202"],
            fixtureKeys: [],
            pinRefs: ["47"],
            revisionLabels: ["R0.2"],
            signalNames: ["VBAT_IN"]
          },
          sizeBytes: 2048,
          sortPlan: {
            action: "leave_in_place",
            reason: "This file is already in the suggested standard folder.",
            sourceRelativePath: "hardware/CAB-DEMO-PMC-JST-PWR/CAB-DEMO-PMC-JST-PWR-pinout.csv",
            targetCategory: "hardware",
            targetFolderLabel: "Custom designs",
            targetRelativePath: "hardware/CAB-DEMO-PMC-JST-PWR/CAB-DEMO-PMC-JST-PWR-pinout.csv"
          },
          suggestedCategory: "hardware"
        },
        {
          confidenceScore: 0.35,
          currentCategory: null,
          documentType: "unknown",
          extraction: null,
          filename: "notes-from-bob.tmp",
          id: "doc-random-notes-from-bob-tmp",
          modifiedAt: "2025-01-05T12:00:00.000Z",
          needsAttention: true,
          outsideStandardFolders: true,
          parentFolder: "random",
          reason: "No strong document clue found.",
          relativePath: "random/notes-from-bob.tmp",
          signals: {
            cableKeys: [],
            connectorRefs: [],
            fixtureKeys: [],
            pinRefs: [],
            revisionLabels: [],
            signalNames: []
          },
          sizeBytes: 64,
          sortPlan: {
            action: "review_unknown",
            reason: "Open this file or rename it with a clearer document type before sorting.",
            sourceRelativePath: "random/notes-from-bob.tmp",
            targetCategory: null,
            targetFolderLabel: null,
            targetRelativePath: null
          },
          suggestedCategory: null
        }
      ],
      folderPatterns: [
        {
          confidenceScore: 0.97,
          currentCategory: null,
          dominantDocumentType: "test_procedure",
          dominantTypeCount: 2,
          exampleFilenames: ["J202-atp-run-sheet-rev-d.docx", "J202-test-procedure-rev-d.pdf"],
          fileCount: 2,
          folderPath: "Bob-drop/old-tests",
          id: "folder-pattern-bob-drop-old-tests",
          moveSuggestionCount: 2,
          outsideStandardFolders: true,
          reason: "Folder name and file names point most of these files toward Notes.",
          signals: {
            cableKeys: [],
            connectorRefs: ["J202"],
            fixtureKeys: [],
            pinRefs: ["47", "48"],
            revisionLabels: ["Rev D"],
            signalNames: ["RS422_TX+", "RS422_TX-"]
          },
          suggestedAction: "use_file_copy_buttons",
          suggestedCategory: "notes",
          suggestedFolderLabel: "Notes",
          typeCounts: [{ count: 2, documentType: "test_procedure" }],
          unknownDocumentCount: 0
        }
      ],
      generatedAt: "2026-06-16T12:00:00.000Z",
      maxDepth: 6,
      maxFiles: 500,
      scanRootPath: "C:\\EE-Library\\projects\\ALPHA",
      summary: {
        connectorMentionCount: 3,
        documentCount: 4,
        extractionFailedCount: 0,
        extractionQueuedCount: 1,
        extractionRunningCount: 0,
        extractionSucceededCount: 1,
        extractionUnsupportedCount: 0,
        folderPatternCount: 1,
        folderCount: 8,
        lowConfidenceCount: 1,
        mixedFolderCount: 0,
        moveSuggestionCount: 2,
        outsideStandardFolderCount: 3,
        pinMentionCount: 3,
        skippedCount: 0,
        unknownDocumentCount: 1
      }
    },
    folders: [
      {
        absolutePath: "C:\\EE-Library\\projects\\ALPHA\\parts-list",
        category: "parts_list",
        description: "BOM exports, CSV imports, and other parts list source files.",
        entries: [
          {
            isFile: true,
            modifiedAt: "2025-01-03T10:00:00.000Z",
            name: "alpha-bom.csv",
            sizeBytes: 2048
          }
        ],
        label: "Parts list"
      },
      {
        absolutePath: "C:\\EE-Library\\projects\\ALPHA\\hardware",
        category: "hardware",
        description: "Internal boards, fixtures, harnesses, adapters, cables, and test hardware.",
        entries: [
          {
            isFile: false,
            modifiedAt: "2025-01-05T12:00:00.000Z",
            name: "PTA-1001",
            sizeBytes: null
          }
        ],
        label: "Custom designs"
      },
      {
        absolutePath: "C:\\EE-Library\\projects\\ALPHA\\datasheets",
        category: "datasheets",
        description: "Reviewed datasheets and source documents.",
        entries: [
          {
            isFile: true,
            modifiedAt: "2025-01-02T10:00:00.000Z",
            name: "alpha-drawing.pdf",
            sizeBytes: 4096
          }
        ],
        label: "Datasheets"
      },
      {
        absolutePath: "C:\\EE-Library\\projects\\ALPHA\\models",
        category: "models",
        description: "3D models, native CAD exports, and mechanical references.",
        entries: [],
        label: "3D models"
      },
      {
        absolutePath: "C:\\EE-Library\\projects\\ALPHA\\notes",
        category: "notes",
        description: "Project notes, tradeoffs, and re-entry context.",
        entries: [
          {
            isFile: true,
            modifiedAt: "2025-01-04T10:00:00.000Z",
            name: "handoff.md",
            sizeBytes: 512
          },
          {
            isFile: true,
            modifiedAt: "2025-01-04T11:00:00.000Z",
            name: "prior-review.pdf",
            sizeBytes: 1024
          },
          {
            isFile: true,
            modifiedAt: "2025-01-06T11:00:00.000Z",
            name: "review-alpha-drawing-old.md",
            sizeBytes: 1536
          }
        ],
        label: "Notes"
      }
    ],
    message: null,
    projectId: "project-alpha",
    projectKey: "ALPHA",
    rootPath: "C:\\EE-Library\\projects\\ALPHA"
  };
}
