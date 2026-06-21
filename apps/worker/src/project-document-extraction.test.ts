/**
 * File header: Tests PDF and modern Office extraction with real document containers.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import * as XLSX from "xlsx";
import {
  buildProjectDocumentSourceFingerprint,
  PROJECT_DOCUMENT_EXTRACTOR_VERSION,
  PROJECT_DOCUMENT_MAX_FILE_BYTES
} from "@ee-library/shared/project-document-extraction";
import type { ProjectDocumentExtractionFormat } from "@ee-library/shared/types";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import {
  extractDocxDocument,
  extractPdfDocument,
  extractPptxDocument,
  extractXlsxDocument,
  processProjectDocumentExtractionJobs
} from "./project-document-extraction";

test("extractPdfDocument preserves page labels and engineering clues", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const firstPage = document.addPage();
  firstPage.drawText("Overview for the bring-up procedure.", { font, size: 12, x: 40, y: 700 });
  const secondPage = document.addPage();
  secondPage.drawText("Connector J202 pin 47 carries RS422_TX+.", { font, size: 12, x: 40, y: 700 });

  const output = await extractPdfDocument(Buffer.from(await document.save()));

  assert.equal(output.sourceUnitCount, 2);
  assert.equal(output.segments[1]?.label, "Page 2");
  assert.match(output.segments[1]?.text ?? "", /J202 pin 47/u);
  assert.match(output.extractedText, /RS422_TX\+/u);
});

test("extractDocxDocument groups Word paragraphs into source sections", async () => {
  const output = await extractDocxDocument(await buildMinimalDocx([
    "J202 acceptance test procedure.",
    "Pin 47 carries RS422_TX+.",
    "Use fixture TFX-DEMO-PMC-BRINGUP."
  ]));

  assert.equal(output.sourceUnitCount, 1);
  assert.equal(output.segments[0]?.label, "Paragraphs 1-3");
  assert.match(output.extractedText, /TFX-DEMO-PMC-BRINGUP/u);
});

test("extractXlsxDocument preserves sheet names and cell text", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Connector", "Pin", "Signal"],
      ["J202", "47", "RS422_TX+"]
    ]),
    "Pin Map"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Revision", "Rev D"]]),
    "Revision"
  );
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;

  const output = await extractXlsxDocument(bytes);

  assert.equal(output.sourceUnitCount, 2);
  assert.equal(output.segments[0]?.label, "Sheet: Pin Map");
  assert.match(output.segments[0]?.text ?? "", /J202,47,RS422_TX\+/u);
});

test("extractXlsxDocument bounds large worksheet text before building a full CSV", async () => {
  const rows = Array.from({ length: 8_000 }, (_, index) => [
    `J${index + 1}`,
    String(index + 1),
    `SIGNAL_${index + 1}_${"X".repeat(20)}`
  ]);
  const output = await extractXlsxDocument(buildXlsx(rows));

  assert.equal(output.sourceUnitCount, 1);
  assert.ok((output.segments[0]?.text.length ?? 0) <= 20_000);
  assert.match(output.segments[0]?.text ?? "", /J1,1,SIGNAL_1/u);
  assert.doesNotMatch(output.segments[0]?.text ?? "", /J8000,8000/u);
});

test("extractPptxDocument preserves slide numbers and ordered text", async () => {
  const archive = new JSZip();
  archive.file(
    "ppt/slides/slide1.xml",
    buildSlideXml(["Bring-up overview", "Fixture TFX-DEMO-PMC-BRINGUP"])
  );
  archive.file(
    "ppt/slides/slide2.xml",
    buildSlideXml(["Connector J202", "Pin 47", "RS422_TX+"])
  );

  const output = await extractPptxDocument(await archive.generateAsync({ type: "nodebuffer" }));

  assert.equal(output.sourceUnitCount, 2);
  assert.equal(output.segments[1]?.label, "Slide 2");
  assert.match(output.segments[1]?.text ?? "", /Connector J202 Pin 47 RS422_TX\+/u);
});

test("extractPptxDocument bounds large provenance payloads and previews", async () => {
  const largeSlideText = `Connector J202 pin 47 ${"A".repeat(25_000)}`;
  const slides = Array.from({ length: 600 }, () => [largeSlideText]);

  const output = await extractPptxDocument(await buildPptx(slides));
  const persistedSegmentCharacters = output.segments.reduce(
    (total, segment) => total + segment.text.length,
    0
  );

  assert.equal(output.sourceUnitCount, 600);
  assert.ok(output.extractedCharacterCount <= 2_000_000);
  assert.ok(persistedSegmentCharacters <= 2_000_000);
  assert.ok(output.segments.length <= 500);
  assert.ok(output.segments.every((segment) => segment.text.length <= 20_000));
  assert.ok(output.segments.every((segment) => segment.textPreview.length <= 320));
});

test("worker processes a mixed real-file batch and records honest recovery states", async () => {
  const databasePool = createWorkerExtractionPool();
  const fixtureRoot = await createFixtureRoot();
  const projectKey = "MIXED";
  const projectRoot = path.join(fixtureRoot, projectKey);
  const previousRoot = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = fixtureRoot;
  setWorkerRepositoryPoolForTests(databasePool);

  try {
    await mkdir(path.join(projectRoot, "incoming"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "incoming", "procedure.pdf"),
      await buildPdf([
        "Acceptance test overview.",
        "Connector J202 pin 47 carries RS422_TX+."
      ])
    );
    await writeFile(
      path.join(projectRoot, "incoming", "procedure.docx"),
      await buildMinimalDocx([
        "Fixture TFX-DEMO-PMC-BRINGUP.",
        "Cable CAB-DEMO-PMC-JST-PWR.",
        "Confirm J202 pin 47."
      ])
    );
    await writeFile(
      path.join(projectRoot, "incoming", "pin-map.xlsx"),
      buildXlsx([
        ["Connector", "Pin", "Signal"],
        ["J202", "47", "RS422_TX+"]
      ])
    );
    await writeFile(
      path.join(projectRoot, "incoming", "review.pptx"),
      await buildPptx([
        ["Bring-up review", "Revision D"],
        ["Connector J202", "Pin 47", "RS422_TX+"]
      ])
    );
    await writeFile(
      path.join(projectRoot, "incoming", "blank.pdf"),
      await buildPdf([""])
    );
    await writeFile(
      path.join(projectRoot, "incoming", "corrupt.pdf"),
      Buffer.from("not a PDF", "utf8")
    );
    await writeFile(
      path.join(projectRoot, "incoming", "changed.docx"),
      await buildMinimalDocx(["This file changed after queueing."])
    );
    const oversizedPath = path.join(projectRoot, "incoming", "oversized.pdf");
    const oversizedHandle = await open(oversizedPath, "w");
    await oversizedHandle.truncate(PROJECT_DOCUMENT_MAX_FILE_BYTES + 1);
    await oversizedHandle.close();

    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "mixed-pdf",
      relativePath: "incoming/procedure.pdf"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "docx",
      id: "mixed-docx",
      relativePath: "incoming/procedure.docx"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "xlsx",
      id: "mixed-xlsx",
      relativePath: "incoming/pin-map.xlsx"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pptx",
      id: "mixed-pptx",
      relativePath: "incoming/review.pptx"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "blank-pdf",
      relativePath: "incoming/blank.pdf"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "corrupt-pdf",
      relativePath: "incoming/corrupt.pdf"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      fingerprintOverride: "stale-fingerprint",
      format: "docx",
      id: "changed-docx",
      relativePath: "incoming/changed.docx"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "oversized-pdf",
      relativePath: "incoming/oversized.pdf"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "missing-pdf",
      relativePath: "incoming/missing.pdf",
      sourceModifiedAt: null,
      sourceSizeBytes: 1024
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "unsafe-pdf",
      relativePath: "../escape.pdf",
      sourceModifiedAt: null,
      sourceSizeBytes: 1024
    });

    const startedAt = performance.now();
    const summary = await processProjectDocumentExtractionJobs(10);
    const elapsedMs = performance.now() - startedAt;
    const rows = await databasePool.query<{
      error_code: string | null;
      extracted_segments: Array<{ label: string }>;
      extraction_status: string;
      id: string;
      progress_percent: number;
    }>(`
      SELECT id, extraction_status, progress_percent, error_code, extracted_segments
      FROM project_document_extractions
      ORDER BY id
    `);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const failureCodes = new Set(
      summary.processed
        .map((row) => row.errorCode)
        .filter((code): code is string => code !== null)
    );

    assert.equal(summary.processed.length, 10);
    assert.equal(summary.processed.filter((row) => row.status === "succeeded").length, 4);
    assert.equal(summary.processed.filter((row) => row.status === "failed").length, 6);
    assert.equal(byId.get("mixed-pdf")?.progress_percent, 100);
    assert.equal(byId.get("mixed-pdf")?.extracted_segments[1]?.label, "Page 2");
    assert.equal(byId.get("mixed-docx")?.extracted_segments[0]?.label, "Paragraphs 1-3");
    assert.equal(byId.get("mixed-xlsx")?.extracted_segments[0]?.label, "Sheet: Pin Map");
    assert.equal(byId.get("mixed-pptx")?.extracted_segments[1]?.label, "Slide 2");
    assert.deepEqual(
      [...failureCodes].sort(),
      [
        "INVALID_PDF",
        "INVALID_SOURCE_PATH",
        "NO_SEARCHABLE_TEXT",
        "SOURCE_FILE_CHANGED",
        "SOURCE_FILE_MISSING",
        "SOURCE_FILE_TOO_LARGE"
      ]
    );
    assert.ok(elapsedMs < 15_000, `Mixed extraction batch took ${Math.round(elapsedMs)} ms.`);
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await databasePool.end();
    restoreProjectFilesRoot(previousRoot);
    await removeFixtureRoot(fixtureRoot);
  }
});

test("worker bounds concurrent readers and cannot overwrite a newer queued fingerprint", async () => {
  const databasePool = createWorkerExtractionPool();
  const fixtureRoot = await createFixtureRoot();
  const projectKey = "RACE";
  const projectRoot = path.join(fixtureRoot, projectKey);
  const previousRoot = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = fixtureRoot;
  setWorkerRepositoryPoolForTests(databasePool);

  try {
    await mkdir(path.join(projectRoot, "incoming"), { recursive: true });
    for (let index = 1; index <= 4; index += 1) {
      const relativePath = `incoming/long-${index}.pdf`;
      await writeFile(
        path.join(projectRoot, relativePath),
        await buildPdf(
          Array.from(
            { length: 30 },
            (_, pageIndex) => `Document ${index}, page ${pageIndex + 1}: J202 pin 47 RS422_TX+.`
          )
        )
      );
      await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
        format: "pdf",
        id: `race-${index}`,
        relativePath
      });
    }

    const processing = processProjectDocumentExtractionJobs(2);
    const runningIds = await waitForRunningJobs(databasePool, 2);
    assert.equal(runningIds.length, 2);

    const supersededId = runningIds[0];
    assert.ok(supersededId);
    await databasePool.query(
      `
        UPDATE project_document_extractions
        SET
          extraction_status = 'queued',
          source_fingerprint = 'newer-fingerprint',
          progress_percent = 0,
          progress_message = 'File changed. Waiting for the document reader.'
        WHERE id = $1
      `,
      [supersededId]
    );

    const summary = await processing;
    const rows = await databasePool.query<{
      extracted_text: string | null;
      extraction_status: string;
      id: string;
      source_fingerprint: string;
    }>(`
      SELECT id, extraction_status, source_fingerprint, extracted_text
      FROM project_document_extractions
      ORDER BY id
    `);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    assert.equal(summary.processed.length, 2);
    assert.equal(summary.processed.filter((row) => row.status === "superseded").length, 1);
    assert.equal(summary.processed.filter((row) => row.status === "succeeded").length, 1);
    assert.equal(byId.get(supersededId)?.extraction_status, "queued");
    assert.equal(byId.get(supersededId)?.source_fingerprint, "newer-fingerprint");
    assert.equal(byId.get(supersededId)?.extracted_text, null);
    assert.equal(rows.rows.filter((row) => row.extraction_status === "running").length, 0);
    assert.equal(rows.rows.filter((row) => row.extraction_status === "queued").length, 3);
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await databasePool.end();
    restoreProjectFilesRoot(previousRoot);
    await removeFixtureRoot(fixtureRoot);
  }
});

test("worker retries abandoned running work without stealing a fresh running job", async () => {
  const databasePool = createWorkerExtractionPool();
  const fixtureRoot = await createFixtureRoot();
  const projectKey = "RECOVERY";
  const projectRoot = path.join(fixtureRoot, projectKey);
  const previousRoot = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = fixtureRoot;
  setWorkerRepositoryPoolForTests(databasePool);

  try {
    await mkdir(path.join(projectRoot, "incoming"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "incoming", "abandoned.pdf"),
      await buildPdf(["Abandoned read for connector J202 pin 47."])
    );
    await writeFile(
      path.join(projectRoot, "incoming", "active.pdf"),
      await buildPdf(["Active read for connector J202 pin 48."])
    );
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "abandoned-running",
      relativePath: "incoming/abandoned.pdf"
    });
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "pdf",
      id: "active-running",
      relativePath: "incoming/active.pdf"
    });
    await databasePool.query(`
      UPDATE project_document_extractions
      SET
        extraction_status = 'running',
        progress_percent = 35,
        progress_message = 'Reading page 1 of 2.',
        started_at = now(),
        last_updated_at = now() - INTERVAL '20 minutes'
      WHERE id = 'abandoned-running';

      UPDATE project_document_extractions
      SET
        extraction_status = 'running',
        progress_percent = 50,
        progress_message = 'Reading page 1 of 2.',
        started_at = now(),
        last_updated_at = now()
      WHERE id = 'active-running';
    `);

    const summary = await processProjectDocumentExtractionJobs(1);
    const rows = await databasePool.query<{
      extraction_status: string;
      id: string;
      progress_percent: number;
    }>(`
      SELECT id, extraction_status, progress_percent
      FROM project_document_extractions
      ORDER BY id
    `);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    assert.equal(summary.recoveredStaleCount, 1);
    assert.equal(summary.processed.length, 1);
    assert.equal(summary.processed[0]?.jobId, "abandoned-running");
    assert.equal(summary.processed[0]?.status, "succeeded");
    assert.equal(byId.get("abandoned-running")?.extraction_status, "succeeded");
    assert.equal(byId.get("abandoned-running")?.progress_percent, 100);
    assert.equal(byId.get("active-running")?.extraction_status, "running");
    assert.equal(byId.get("active-running")?.progress_percent, 50);
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await databasePool.end();
    restoreProjectFilesRoot(previousRoot);
    await removeFixtureRoot(fixtureRoot);
  }
});

test("worker throttles progress writes across a workbook with many sheets", async () => {
  let progressWriteCount = 0;
  const databasePool = createWorkerExtractionPool((sql) => {
    if (/SET\s+progress_percent = \$2,\s+progress_message = \$3/iu.test(sql)) {
      progressWriteCount += 1;
    }
  });
  const fixtureRoot = await createFixtureRoot();
  const projectKey = "PROGRESS";
  const projectRoot = path.join(fixtureRoot, projectKey);
  const previousRoot = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = fixtureRoot;
  setWorkerRepositoryPoolForTests(databasePool);

  try {
    await mkdir(path.join(projectRoot, "incoming"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "incoming", "many-sheets.xlsx"),
      buildMultiSheetXlsx(120)
    );
    await queueWorkerExtraction(databasePool, fixtureRoot, projectKey, {
      format: "xlsx",
      id: "many-sheets",
      relativePath: "incoming/many-sheets.xlsx"
    });

    const summary = await processProjectDocumentExtractionJobs(1);

    assert.equal(summary.processed[0]?.status, "succeeded");
    assert.ok(
      progressWriteCount <= 20,
      `Expected at most 20 progress writes, received ${progressWriteCount}.`
    );
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await databasePool.end();
    restoreProjectFilesRoot(previousRoot);
    await removeFixtureRoot(fixtureRoot);
  }
});

/** Builds a small valid DOCX container for extraction tests. */
async function buildMinimalDocx(paragraphs: string[]): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`
  );
  archive.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`
  );
  archive.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`).join("")}
          <w:sectPr/>
        </w:body>
      </w:document>`
  );

  return archive.generateAsync({ type: "nodebuffer" });
}

/** Builds a real PDF with one fixture string per page. */
async function buildPdf(pageTexts: string[]): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const text of pageTexts) {
    const page = document.addPage();
    if (text) {
      page.drawText(text, { font, size: 12, x: 40, y: 700 });
    }
  }

  return Buffer.from(await document.save());
}

/** Builds one workbook buffer from a single Pin Map sheet. */
function buildXlsx(rows: string[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Pin Map");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/** Builds a workbook with many small sheets for progress-write throttling tests. */
function buildMultiSheetXlsx(sheetCount: number): Buffer {
  const workbook = XLSX.utils.book_new();
  for (let index = 0; index < sheetCount; index += 1) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Connector", "Pin", "Signal"],
        ["J202", String(index + 1), `SIGNAL_${index + 1}`]
      ]),
      `Sheet ${index + 1}`
    );
  }
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/** Builds a PPTX-compatible archive with ordered slide XML files. */
async function buildPptx(slides: string[][]): Promise<Buffer> {
  const archive = new JSZip();
  slides.forEach((values, index) => {
    archive.file(`ppt/slides/slide${index + 1}.xml`, buildSlideXml(values));
  });
  return archive.generateAsync({ type: "nodebuffer" });
}

/** Builds one minimal slide XML body containing ordered text runs. */
function buildSlideXml(values: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody>
              ${values.map((value) => `<a:p><a:r><a:t>${escapeXml(value)}</a:t></a:r></a:p>`).join("")}
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`;
}

/** Escapes a test string before embedding it in Open XML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

/** Creates the worker queue schema needed by filesystem-backed extraction tests. */
function createWorkerExtractionPool(onQuery?: (sql: string) => void): Pool {
  const db = newDb();
  db.public.none(`
    CREATE TABLE project_document_extractions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
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
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  if (onQuery) {
    db.public.interceptQueries((sql) => {
      onQuery(sql);
      return null;
    });
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}

/** Creates one isolated project-file mirror inside the repository workspace. */
async function createFixtureRoot(): Promise<string> {
  return mkdtemp(path.resolve(".tmp-project-document-extraction-"));
}

/** Removes only a generated fixture root beneath the current workspace. */
async function removeFixtureRoot(fixtureRoot: string): Promise<void> {
  const workspaceRoot = path.resolve(".");
  const expectedPrefix = `${workspaceRoot}${path.sep}.tmp-project-document-extraction-`;
  const resolvedFixtureRoot = path.resolve(fixtureRoot);
  if (!resolvedFixtureRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected fixture root: ${resolvedFixtureRoot}`);
  }

  // Windows can briefly retain an XLSX file after the parser releases its in-memory
  // workbook. Bounded native retries keep fixture cleanup deterministic without hiding
  // persistent permission errors or deleting outside the verified test directory.
  await rm(resolvedFixtureRoot, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100
  });
}

/** Restores the project-file mirror environment after one isolated worker test. */
function restoreProjectFilesRoot(previousRoot: string | undefined): void {
  if (previousRoot === undefined) {
    delete process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
    return;
  }
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = previousRoot;
}

/** Inserts one queued worker row using the exact current filesystem fingerprint. */
async function queueWorkerExtraction(
  databasePool: Pool,
  fixtureRoot: string,
  projectKey: string,
  input: {
    fingerprintOverride?: string;
    format: ProjectDocumentExtractionFormat;
    id: string;
    relativePath: string;
    sourceModifiedAt?: string | null;
    sourceSizeBytes?: number;
  }
): Promise<void> {
  const sourcePath = path.resolve(
    fixtureRoot,
    projectKey,
    input.relativePath.replace(/\//gu, path.sep)
  );
  const sourceInfo = await stat(sourcePath).catch(() => null);
  const sourceModifiedAt =
    input.sourceModifiedAt !== undefined
      ? input.sourceModifiedAt
      : sourceInfo?.mtime.toISOString() ?? null;
  const sourceSizeBytes = input.sourceSizeBytes ?? sourceInfo?.size ?? 0;
  const sourceFingerprint =
    input.fingerprintOverride ??
    buildProjectDocumentSourceFingerprint({
      modifiedAt: sourceModifiedAt,
      relativePath: input.relativePath,
      sizeBytes: sourceSizeBytes
    });

  await databasePool.query(
    `
      INSERT INTO project_document_extractions (
        id,
        project_id,
        project_key,
        relative_path,
        filename,
        extraction_format,
        extractor_version,
        source_fingerprint,
        source_size_bytes,
        source_modified_at,
        extraction_status,
        progress_percent,
        progress_message
      )
      VALUES ($1, 'project-worker-test', $2, $3, $4, $5, $6, $7, $8, $9, 'queued', 0, 'Waiting for the document reader.')
    `,
    [
      input.id,
      projectKey,
      input.relativePath,
      path.basename(input.relativePath),
      input.format,
      PROJECT_DOCUMENT_EXTRACTOR_VERSION,
      sourceFingerprint,
      sourceSizeBytes,
      sourceModifiedAt
    ]
  );
}

/** Waits until the worker has claimed the expected bounded concurrent wave. */
async function waitForRunningJobs(databasePool: Pool, expectedCount: number): Promise<string[]> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = await databasePool.query<{ id: string }>(`
      SELECT id
      FROM project_document_extractions
      WHERE extraction_status = 'running'
      ORDER BY id
    `);
    if (result.rows.length === expectedCount) {
      return result.rows.map((row) => row.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return [];
}
