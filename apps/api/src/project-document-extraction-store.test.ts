/**
 * File header: Tests project-document extraction queueing, cache reuse, progress, and retry.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import type { ProjectDocumentMapEntry } from "@ee-library/shared/types";
import {
  readProjectDocumentExtractions,
  readProjectDocumentExtractionStatuses,
  requeueProjectDocumentExtraction,
  searchProjectDocumentExtractions,
  setProjectDocumentExtractionStorePoolForTests,
  syncProjectDocumentExtractions
} from "./project-document-extraction-store";
import { enterRequestContextForTests } from "./request-context";

test("project document extraction store queues changed files and reuses completed text", async () => {
  const databasePool = createExtractionPool();
  setProjectDocumentExtractionStorePoolForTests(databasePool);

  try {
    await databasePool.query(`
      INSERT INTO projects (id, project_key)
      VALUES ('project-alpha', 'ALPHA')
    `);
    const pdfDocument = buildDocumentEntry({
      filename: "J202-test.pdf",
      modifiedAt: "2026-06-18T10:00:00.000Z",
      relativePath: "incoming/J202-test.pdf",
      sizeBytes: 4096
    });
    const legacyDocument = buildDocumentEntry({
      filename: "old-pinout.doc",
      modifiedAt: "2026-06-18T10:00:00.000Z",
      relativePath: "incoming/old-pinout.doc",
      sizeBytes: 2048
    });

    const first = await syncProjectDocumentExtractions(
      "project-alpha",
      "ALPHA",
      [pdfDocument, legacyDocument]
    );
    assert.equal(first.queuedCount, 1);
    assert.equal(first.records.find((record) => record.relativePath === pdfDocument.relativePath)?.state.status, "queued");
    assert.equal(first.records.find((record) => record.relativePath === legacyDocument.relativePath)?.state.status, "unsupported");

    await databasePool.query(
      `
        UPDATE project_document_extractions
        SET
          extraction_status = 'succeeded',
          progress_percent = 100,
          progress_message = 'Text ready from 1 source section.',
          source_unit_count = 1,
          extracted_character_count = 41,
          extracted_text = 'Connector J202 pin 47 carries RS422_TX+.',
          extracted_segments = $2::jsonb,
          source_location_previews = $2::jsonb,
          started_at = '2026-06-18T10:00:01.000Z',
          completed_at = '2026-06-18T10:00:02.000Z'
        WHERE project_id = $1
      `,
      [
        "project-alpha",
        JSON.stringify([
          {
            label: "Page 2",
            text: "Connector J202 pin 47 carries RS422_TX+.",
            textPreview: "Connector J202 pin 47 carries RS422_TX+."
          }
        ])
      ]
    );

    const unchanged = await syncProjectDocumentExtractions(
      "project-alpha",
      "ALPHA",
      [pdfDocument]
    );
    assert.equal(unchanged.queuedCount, 0);
    assert.equal(unchanged.records[0]?.state.status, "succeeded");
    assert.equal(unchanged.records[0]?.sourceSegments[0]?.label, "Page 2");

    const changed = await syncProjectDocumentExtractions(
      "project-alpha",
      "ALPHA",
      [
        {
          ...pdfDocument,
          modifiedAt: "2026-06-18T11:00:00.000Z",
          sizeBytes: 5000
        }
      ]
    );
    assert.equal(changed.queuedCount, 1);
    assert.equal(changed.records[0]?.state.status, "queued");
    assert.equal(changed.records[0]?.extractedText, null);

    const queuedRetry = await requeueProjectDocumentExtraction(
      "project-alpha",
      pdfDocument.relativePath
    );
    assert.equal(queuedRetry.status, "not_found");
    await databasePool.query(
      `
        UPDATE project_document_extractions
        SET extraction_status = 'failed'
        WHERE project_id = $1
      `,
      ["project-alpha"]
    );

    const retry = await requeueProjectDocumentExtraction(
      "project-alpha",
      pdfDocument.relativePath
    );
    assert.equal(retry.status, "ok");
    const retried = await readProjectDocumentExtractions("project-alpha");
    assert.equal(retried[0]?.state.progressMessage, "Retry requested. Waiting for the document reader.");
  } finally {
    setProjectDocumentExtractionStorePoolForTests(null);
    await databasePool.end();
  }
});

test("project document extraction store prunes deleted files only after a complete scan", async () => {
  const databasePool = createExtractionPool();
  setProjectDocumentExtractionStorePoolForTests(databasePool);

  try {
    await databasePool.query(`
      INSERT INTO projects (id, project_key)
      VALUES ('project-cleanup', 'CLEANUP')
    `);
    const firstDocument = buildDocumentEntry({
      filename: "first.pdf",
      modifiedAt: "2026-06-19T10:00:00.000Z",
      relativePath: "incoming/first.pdf",
      sizeBytes: 4096
    });
    const secondDocument = buildDocumentEntry({
      filename: "second.docx",
      modifiedAt: "2026-06-19T10:00:00.000Z",
      relativePath: "incoming/second.docx",
      sizeBytes: 8192
    });

    await syncProjectDocumentExtractions(
      "project-cleanup",
      "CLEANUP",
      [firstDocument, secondDocument],
      { pruneMissing: true }
    );
    await syncProjectDocumentExtractions(
      "project-cleanup",
      "CLEANUP",
      [firstDocument]
    );
    const afterPartialSync = await databasePool.query<{ relative_path: string }>(
      `SELECT relative_path FROM project_document_extractions WHERE project_id = $1`,
      ["project-cleanup"]
    );
    assert.equal(afterPartialSync.rows.length, 2);

    await syncProjectDocumentExtractions(
      "project-cleanup",
      "CLEANUP",
      [firstDocument],
      { pruneMissing: true }
    );
    const afterCompleteSync = await databasePool.query<{ relative_path: string }>(
      `SELECT relative_path FROM project_document_extractions WHERE project_id = $1`,
      ["project-cleanup"]
    );
    assert.deepEqual(
      afterCompleteSync.rows.map((row) => row.relative_path),
      ["incoming/first.pdf"]
    );

    const legacyOnly = await syncProjectDocumentExtractions(
      "project-cleanup",
      "CLEANUP",
      [
        buildDocumentEntry({
          filename: "legacy.doc",
          modifiedAt: "2026-06-19T10:00:00.000Z",
          relativePath: "incoming/legacy.doc",
          sizeBytes: 2048
        })
      ],
      { pruneMissing: true }
    );
    const afterNoSupportedDocuments = await databasePool.query(
      `SELECT id FROM project_document_extractions WHERE project_id = $1`,
      ["project-cleanup"]
    );
    assert.equal(afterNoSupportedDocuments.rows.length, 0);
    assert.equal(legacyOnly.records[0]?.state.status, "unsupported");
  } finally {
    setProjectDocumentExtractionStorePoolForTests(null);
    await databasePool.end();
  }
});

test("project document extraction status reads stay lightweight and retain global queue positions", async () => {
  const databasePool = createExtractionPool();
  setProjectDocumentExtractionStorePoolForTests(databasePool);

  try {
    await databasePool.query(`
      INSERT INTO projects (id, project_key)
      VALUES
        ('project-earlier', 'EARLIER'),
        ('project-status', 'STATUS')
    `);
    await syncProjectDocumentExtractions(
      "project-earlier",
      "EARLIER",
      [
        buildDocumentEntry({
          filename: "earlier.pdf",
          modifiedAt: "2026-06-19T10:00:00.000Z",
          relativePath: "incoming/earlier.pdf",
          sizeBytes: 1024
        })
      ]
    );
    await syncProjectDocumentExtractions(
      "project-status",
      "STATUS",
      [
        buildDocumentEntry({
          filename: "ready.xlsx",
          modifiedAt: "2026-06-19T10:00:00.000Z",
          relativePath: "incoming/ready.xlsx",
          sizeBytes: 2048
        }),
        buildDocumentEntry({
          filename: "waiting.pptx",
          modifiedAt: "2026-06-19T10:00:00.000Z",
          relativePath: "incoming/waiting.pptx",
          sizeBytes: 4096
        })
      ]
    );
    await databasePool.query(`
      UPDATE project_document_extractions
      SET requested_at = '2026-06-19T10:00:00.000Z'
      WHERE project_id = 'project-earlier';

      UPDATE project_document_extractions
      SET requested_at = '2026-06-19T10:01:00.000Z'
      WHERE relative_path = 'incoming/ready.xlsx';

      UPDATE project_document_extractions
      SET requested_at = '2026-06-19T10:02:00.000Z'
      WHERE relative_path = 'incoming/waiting.pptx';
    `);

    const queuedStatuses = await readProjectDocumentExtractionStatuses("project-status");
    const queuedByPath = new Map(
      queuedStatuses.records.map((record) => [record.relativePath, record.extraction])
    );
    assert.equal(queuedStatuses.activeCount, 2);
    assert.equal(queuedByPath.get("incoming/ready.xlsx")?.queuePosition, 2);
    assert.equal(queuedByPath.get("incoming/waiting.pptx")?.queuePosition, 3);

    await databasePool.query(`
      UPDATE project_document_extractions
      SET
        extraction_status = 'succeeded',
        progress_percent = 100,
        progress_message = 'Text ready from 1 source section.',
        source_unit_count = 1,
        extracted_character_count = 24,
        extracted_text = 'J202 pin 47 is RS422_TX+',
        extracted_segments = '[{"label":"Sheet: Pin Map","text":"J202 pin 47 is RS422_TX+","textPreview":"J202 pin 47 is RS422_TX+"}]'::jsonb
      WHERE relative_path = 'incoming/ready.xlsx'
    `);
    const completedStatuses = await readProjectDocumentExtractionStatuses("project-status");
    const completedReadyState = completedStatuses.records.find(
      (record) => record.relativePath === "incoming/ready.xlsx"
    )?.extraction;

    assert.equal(completedStatuses.activeCount, 1);
    assert.equal(completedReadyState?.searchableTextAvailable, true);
    assert.deepEqual(completedReadyState?.sourceLocations, []);

    const matchingRows = await searchProjectDocumentExtractions(
      "project-status",
      ["J202", "47"]
    );
    const nonmatchingRows = await searchProjectDocumentExtractions(
      "project-status",
      ["J202", "48"]
    );
    assert.equal(matchingRows.length, 1);
    assert.equal(matchingRows[0]?.relativePath, "incoming/ready.xlsx");
    assert.equal(nonmatchingRows.length, 0);
  } finally {
    setProjectDocumentExtractionStorePoolForTests(null);
    await databasePool.end();
  }
});

test("project document extraction store batches large mixed scans into one insert", async () => {
  let extractionInsertCount = 0;
  const databasePool = createExtractionPool((sql) => {
    if (/INSERT INTO project_document_extractions/iu.test(sql)) {
      extractionInsertCount += 1;
    }
  });
  setProjectDocumentExtractionStorePoolForTests(databasePool);

  try {
    await databasePool.query(`
      INSERT INTO projects (id, project_key)
      VALUES ('project-batch', 'BATCH')
    `);
    const extensions = ["pdf", "docx", "xlsx", "pptx"] as const;
    const documents = Array.from({ length: 160 }, (_, index) => {
      const extension = extensions[index % extensions.length] ?? "pdf";
      return buildDocumentEntry({
        filename: `document-${String(index).padStart(3, "0")}.${extension}`,
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: `incoming/document-${String(index).padStart(3, "0")}.${extension}`,
        sizeBytes: 1024 + index
      });
    });

    const result = await syncProjectDocumentExtractions(
      "project-batch",
      "BATCH",
      documents
    );

    assert.equal(result.queuedCount, 160);
    assert.equal(result.records.length, 160);
    assert.equal(extractionInsertCount, 1);

    const unchanged = await syncProjectDocumentExtractions(
      "project-batch",
      "BATCH",
      documents
    );
    assert.equal(unchanged.queuedCount, 0);
    assert.equal(extractionInsertCount, 2);
  } finally {
    setProjectDocumentExtractionStorePoolForTests(null);
    await databasePool.end();
  }
});

test("project document extraction store exposes every active and recovery state", async () => {
  const databasePool = createExtractionPool();
  setProjectDocumentExtractionStorePoolForTests(databasePool);

  try {
    await databasePool.query(`
      INSERT INTO projects (id, project_key)
      VALUES ('project-states', 'STATES')
    `);
    const documents = [
      buildDocumentEntry({
        filename: "queued.pdf",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/queued.pdf",
        sizeBytes: 4096
      }),
      buildDocumentEntry({
        filename: "running.docx",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/running.docx",
        sizeBytes: 8192
      }),
      buildDocumentEntry({
        filename: "ready.xlsx",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/ready.xlsx",
        sizeBytes: 12_288
      }),
      buildDocumentEntry({
        filename: "failed.pptx",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/failed.pptx",
        sizeBytes: 16_384
      }),
      buildDocumentEntry({
        filename: "legacy.doc",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/legacy.doc",
        sizeBytes: 2048
      }),
      buildDocumentEntry({
        filename: "legacy.xls",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/legacy.xls",
        sizeBytes: 2048
      }),
      buildDocumentEntry({
        filename: "legacy.ppt",
        modifiedAt: "2026-06-19T10:00:00.000Z",
        relativePath: "incoming/legacy.ppt",
        sizeBytes: 2048
      })
    ];

    await syncProjectDocumentExtractions("project-states", "STATES", documents);
    await databasePool.query(`
      UPDATE project_document_extractions
      SET
        extraction_status = 'running',
        progress_percent = 42,
        progress_message = 'Reading Word document paragraphs.',
        started_at = now()
      WHERE relative_path = 'incoming/running.docx';

      UPDATE project_document_extractions
      SET
        extraction_status = 'succeeded',
        progress_percent = 100,
        progress_message = 'Text ready from 1 source section.',
        source_unit_count = 1,
        extracted_character_count = 24,
        extracted_text = 'J202 pin 47 is RS422_TX+',
        extracted_segments = '[{"label":"Sheet: Pin Map","text":"J202 pin 47 is RS422_TX+","textPreview":"J202 pin 47 is RS422_TX+"}]'::jsonb,
        source_location_previews = '[{"label":"Sheet: Pin Map","text":"J202 pin 47 is RS422_TX+","textPreview":"J202 pin 47 is RS422_TX+"}]'::jsonb,
        completed_at = now()
      WHERE relative_path = 'incoming/ready.xlsx';

      UPDATE project_document_extractions
      SET
        extraction_status = 'failed',
        progress_percent = 25,
        progress_message = 'The document reader could not finish this file.',
        error_code = 'EXTRACTION_FAILED',
        error_message = 'The original file was not changed.',
        completed_at = now()
      WHERE relative_path = 'incoming/failed.pptx';
    `);

    const result = await syncProjectDocumentExtractions(
      "project-states",
      "STATES",
      documents
    );
    const byPath = new Map(result.records.map((record) => [record.relativePath, record.state]));

    assert.equal(result.queuedCount, 0);
    assert.equal(byPath.get("incoming/queued.pdf")?.status, "queued");
    assert.equal(byPath.get("incoming/queued.pdf")?.queuePosition, 1);
    assert.ok((byPath.get("incoming/queued.pdf")?.estimatedWaitSeconds ?? 0) >= 5);
    assert.equal(byPath.get("incoming/running.docx")?.status, "running");
    assert.equal(byPath.get("incoming/running.docx")?.progressPercent, 42);
    assert.ok((byPath.get("incoming/running.docx")?.estimatedWaitSeconds ?? 0) >= 2);
    assert.equal(byPath.get("incoming/ready.xlsx")?.status, "succeeded");
    assert.equal(byPath.get("incoming/ready.xlsx")?.searchableTextAvailable, true);
    assert.equal(byPath.get("incoming/ready.xlsx")?.sourceLocations[0]?.label, "Sheet: Pin Map");
    assert.equal(byPath.get("incoming/failed.pptx")?.status, "failed");
    assert.equal(byPath.get("incoming/failed.pptx")?.errorCode, "EXTRACTION_FAILED");
    assert.equal(byPath.get("incoming/legacy.doc")?.status, "unsupported");
    assert.equal(byPath.get("incoming/legacy.doc")?.format, "docx");
    assert.equal(byPath.get("incoming/legacy.xls")?.format, "xlsx");
    assert.equal(byPath.get("incoming/legacy.ppt")?.format, "pptx");
  } finally {
    setProjectDocumentExtractionStorePoolForTests(null);
    await databasePool.end();
  }
});

/** Creates the minimal Postgres-compatible schema required by the extraction store. */
function createExtractionPool(onQuery?: (sql: string) => void): Pool {
  const db = newDb();
  /**
   * pg-mem omits PostgreSQL's LEFT function. Register the production behavior so
   * bounded project-page reads are covered instead of swapping in test-only SQL.
   */
  db.public.registerFunction({
    allowNullArguments: true,
    args: [DataType.text, DataType.integer],
    implementation: (value: string | null, length: number) =>
      value === null ? null : value.slice(0, length),
    name: "left",
    returns: DataType.text
  });
  db.public.none(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL
    );

    CREATE TABLE project_document_extractions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      project_key TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      extraction_format TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      source_size_bytes BIGINT NOT NULL,
      source_modified_at TIMESTAMPTZ,
      extraction_status TEXT NOT NULL DEFAULT 'queued',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      progress_message TEXT NOT NULL,
      source_unit_count INTEGER,
      extracted_character_count INTEGER NOT NULL DEFAULT 0,
      extracted_text TEXT,
      extracted_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_location_previews JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_code TEXT,
      error_message TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      org_id TEXT DEFAULT 'org-default',
      UNIQUE (project_id, relative_path)
    );
  `);

  // Tenant isolation (2e): extractions are stamped with the acting org on write. Establish the default
  // tenant for the rest of this test's async execution so the store's insert stamps a non-null org.
  enterRequestContextForTests("org-default");
  if (onQuery) {
    db.public.interceptQueries((sql) => {
      onQuery(sql);
      return null;
    });
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}

/** Builds one mapped document row for queue tests. */
function buildDocumentEntry(input: {
  filename: string;
  modifiedAt: string;
  relativePath: string;
  sizeBytes: number;
}): ProjectDocumentMapEntry {
  return {
    confidenceScore: 0.35,
    currentCategory: null,
    documentType: "unknown",
    extraction: null,
    filename: input.filename,
    id: `doc-${input.filename}`,
    modifiedAt: input.modifiedAt,
    needsAttention: true,
    outsideStandardFolders: true,
    parentFolder: "incoming",
    reason: "No strong document clue found.",
    relativePath: input.relativePath,
    signals: {
      cableKeys: [],
      connectorRefs: [],
      fixtureKeys: [],
      pinRefs: [],
      revisionLabels: [],
      signalNames: []
    },
    sizeBytes: input.sizeBytes,
    sortPlan: {
      action: "review_unknown",
      reason: "Open this file or rename it with a clearer document type before sorting.",
      sourceRelativePath: input.relativePath,
      targetCategory: null,
      targetFolderLabel: null,
      targetRelativePath: null
    },
    suggestedCategory: null
  };
}
