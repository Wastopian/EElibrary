/**
 * File header: Tests the shared application shell wording for the engineering readiness workspace.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RootLayoutShell } from "./RootLayoutShell";

/**
 * Verifies the shared shell reflects the engineering-memory framing instead of a generic catalog title.
 */
test("root layout renders the engineering memory workspace shell", () => {
  const html = renderToStaticMarkup(
    <RootLayoutShell showAccount={false}>
      <main>Child content</main>
    </RootLayoutShell>
  );

  assert.match(html, /Engineering memory/u);
  assert.match(html, /Open projects\. Find parts\. Ship verified files\./u);
  assert.match(html, /Skip to main content/u);
  assert.match(html, /Start here/u);
  assert.match(html, /Projects/u);
  assert.match(html, /Catalog/u);
  assert.match(html, /Where-used/u);
  assert.match(html, /More workspaces/u);
  assert.match(html, /Catalog shortcuts/u);
  assert.match(html, /app-nav__link/u);
  assert.match(html, /app-sidebar/u);
  assert.doesNotMatch(html, /app-main-header/u);
});
