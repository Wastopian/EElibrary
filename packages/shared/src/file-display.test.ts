/**
 * File header: Tests browser open vs download MIME and disposition rules.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFileContentDisposition,
  inferMirrorPathFormat,
  resolveStoredFileContentType,
  shouldServeFileInline
} from "./file-display";

test("resolveStoredFileContentType treats -pdf filenames without extension as PDF", () => {
  assert.equal(resolveStoredFileContentType("cbj3157-pdf", "pdf"), "application/pdf");
  assert.equal(resolveStoredFileContentType("cbj3157-pdf"), "application/pdf");
});

test("shouldServeFileInline opens PDFs by default and downloads when attachment=1", () => {
  const openParams = new URLSearchParams();
  const downloadParams = new URLSearchParams("attachment=1");

  assert.equal(shouldServeFileInline(openParams, "pdf", "application/pdf"), true);
  assert.equal(shouldServeFileInline(downloadParams, "pdf", "application/pdf"), false);
  assert.equal(shouldServeFileInline(openParams, "step", "application/octet-stream"), false);
});

test("inferMirrorPathFormat maps datasheet folder files to PDF", () => {
  assert.equal(inferMirrorPathFormat("datasheets/cbj3157-pdf"), "pdf");
  assert.equal(inferMirrorPathFormat("symbols/cbj3157.kicad_sym"), "kicad_sym");
  assert.equal(inferMirrorPathFormat("mechanical-drawings/cbj3157.dxf"), "dxf");
  assert.equal(inferMirrorPathFormat("mechanical_drawings/cbj3157.dxf"), "dxf");
});

test("buildFileContentDisposition emits inline or attachment", () => {
  assert.equal(buildFileContentDisposition("cbj3157-pdf", true), 'inline; filename="cbj3157-pdf"');
  assert.equal(buildFileContentDisposition("cbj3157-pdf", false), 'attachment; filename="cbj3157-pdf"');
});
