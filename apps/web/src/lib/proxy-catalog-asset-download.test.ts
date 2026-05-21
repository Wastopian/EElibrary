/**
 * File header: Tests inline Content-Disposition handling for proxied catalog downloads.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isViewableCatalogContentType,
  readFilenameFromContentDisposition,
  resolveCatalogAssetContentDisposition,
  shouldPreferInlineDisplay
} from "./proxy-catalog-asset-download";

test("shouldPreferInlineDisplay is true for open links and false for download links", () => {
  assert.equal(shouldPreferInlineDisplay(new URLSearchParams()), true);
  assert.equal(shouldPreferInlineDisplay(new URLSearchParams("attachment=1")), false);
});

test("resolveCatalogAssetContentDisposition rewrites PDF attachments to inline for open links", () => {
  const disposition = resolveCatalogAssetContentDisposition(
    'attachment; filename="cbj3157-pdf"',
    "application/pdf",
    true
  );

  assert.equal(disposition, 'inline; filename="cbj3157-pdf"');
});

test("resolveCatalogAssetContentDisposition forces attachment for download links", () => {
  const disposition = resolveCatalogAssetContentDisposition(
    'inline; filename="cbj3157-pdf"',
    "application/pdf",
    false
  );

  assert.equal(disposition, 'attachment; filename="cbj3157-pdf"');
});

test("resolveCatalogAssetContentDisposition keeps STEP attachments as downloads", () => {
  const disposition = resolveCatalogAssetContentDisposition(
    'attachment; filename="part.step"',
    "application/octet-stream",
    true
  );

  assert.equal(disposition, 'attachment; filename="part.step"');
});

test("isViewableCatalogContentType accepts PDF and images", () => {
  assert.equal(isViewableCatalogContentType("application/pdf"), true);
  assert.equal(isViewableCatalogContentType("image/png"), true);
  assert.equal(isViewableCatalogContentType("application/octet-stream"), false);
});

test("readFilenameFromContentDisposition parses quoted filenames", () => {
  assert.equal(readFilenameFromContentDisposition('attachment; filename="datasheet.pdf"'), "datasheet.pdf");
});
