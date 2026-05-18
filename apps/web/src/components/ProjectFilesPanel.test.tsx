/**
 * File header: Tests the project file mirror UI for custom design records.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
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
  assert.match(html, /2 PDFs/u);
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
  assert.match(html, /Evidence folders.*4\/5/u);
  assert.match(html, /Empty evidence folders.*3D models/u);
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

/**
 * Builds a configured file mirror payload with two custom design records.
 */
function buildProjectFilesResponse(): ProjectFilesResponse {
  return {
    availability: "configured",
    customHardware: {
      boundary: "Custom design notes are file-backed provenance only.",
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
