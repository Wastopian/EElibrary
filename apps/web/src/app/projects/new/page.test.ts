/**
 * File header: Tests the day-zero CSV onboarding page renders honest copy and surfaces
 * recovery banners for each documented failure path (missing MPN, conflict, setup, unauthorized).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectFromCsvPage from "./page";

/**
 * Verifies the bare onboarding page renders the drop zone and honest trust-boundary copy.
 */
test("project from CSV page renders drop zone and trust boundaries when no error is present", async () => {
  const html = await renderProjectFromCsvPage({});

  assert.match(html, /Drop a BOM, see your project/u);
  assert.match(html, /Parts list file/u);
  assert.match(html, /matching is a confirmation step, not approval/u);
  assert.match(html, /What this does and does not do/u);
  assert.match(html, /Matched lines are confirmed usage/u);
  assert.match(html, /Weak and ambiguous rows stay separate/u);
  assert.match(html, /Saving and matching is not approval/u);
  assert.doesNotMatch(html, /could not auto-detect an MPN column/u);
});

/**
 * Verifies missing_mpn_mapping renders the specific recovery copy and surfaces the parsed headers.
 */
test("project from CSV page surfaces missing_mpn_mapping recovery copy with the parsed headers", async () => {
  const html = await renderProjectFromCsvPage({
    error: "missing_mpn_mapping",
    filename: "no-mpn.csv",
    headers: "Designator,Description,Quantity"
  });

  assert.match(html, /could not auto-detect an MPN column/u);
  assert.match(html, /Designator, Description, Quantity/u);
  assert.match(html, /MPN/u);
  assert.match(html, /PartNumber/u);
  assert.match(html, /no-mpn\.csv/u);
});

/**
 * Verifies project_conflict renders recovery copy steering the operator at an existing project.
 */
test("project from CSV page surfaces project_conflict recovery copy", async () => {
  const html = await renderProjectFromCsvPage({
    error: "project_conflict",
    filename: "alpha.csv",
    message: "Project key ALPHA is already in use."
  });

  assert.match(html, /A project with that key already exists/u);
  assert.match(html, /Project key ALPHA is already in use/u);
  assert.match(html, /alpha\.csv/u);
});

/**
 * Verifies not_configured renders setup guidance instead of swallowing the failure.
 */
test("project from CSV page surfaces not_configured recovery copy", async () => {
  const html = await renderProjectFromCsvPage({ error: "not_configured" });

  assert.match(html, /project-memory database is not configured/u);
  assert.match(html, /System checks/u);
});

/**
 * Verifies unauthorized renders a sign-in prompt instead of a generic error.
 */
test("project from CSV page surfaces unauthorized recovery copy", async () => {
  const html = await renderProjectFromCsvPage({ error: "unauthorized" });

  assert.match(html, /sign in/u);
});

/**
 * Verifies invalid_csv renders the parser's plain-English message so the operator can fix the file.
 */
test("project from CSV page surfaces invalid_csv recovery copy with the parser message", async () => {
  const html = await renderProjectFromCsvPage({
    error: "invalid_csv",
    filename: "broken.csv",
    message: "The CSV file is empty."
  });

  assert.match(html, /did not parse as a valid BOM/u);
  assert.match(html, /The CSV file is empty/u);
  assert.match(html, /broken\.csv/u);
});

/**
 * Verifies file_too_large renders the size guidance.
 */
test("project from CSV page surfaces file_too_large recovery copy", async () => {
  const html = await renderProjectFromCsvPage({
    error: "file_too_large",
    filename: "huge.csv"
  });

  assert.match(html, /larger than 4 MB/u);
  assert.match(html, /huge\.csv/u);
});

/**
 * Verifies unsupported_format steers the operator at CSV or XLSX exports.
 */
test("project from CSV page surfaces unsupported_format recovery copy", async () => {
  const html = await renderProjectFromCsvPage({
    error: "unsupported_format",
    filename: "report.pdf"
  });

  assert.match(html, /Only \.csv and \.xlsx files are supported/u);
  assert.match(html, /report\.pdf/u);
});

/**
 * Renders the page server component with the provided search params to static markup.
 */
async function renderProjectFromCsvPage(searchParams: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(
    await ProjectFromCsvPage({ searchParams: Promise.resolve(searchParams) })
  );
}
