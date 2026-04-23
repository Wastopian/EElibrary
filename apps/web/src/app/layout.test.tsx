/**
 * File header: Tests the shared application shell wording for the engineering readiness workspace.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "./layout";

/**
 * Verifies the shared shell reflects the readiness-workspace framing instead of a generic catalog title.
 */
test("root layout renders the engineering readiness workspace shell", () => {
  const html = renderToStaticMarkup(
    <RootLayout>
      <main>Child content</main>
    </RootLayout>
  );

  assert.match(html, /Engineering readiness workspace/u);
  assert.match(html, /Search, inspect, trust, and export/u);
  assert.match(html, /Skip to main content/u);
  assert.match(html, /Catalog workspace/u);
  assert.match(html, /Admin review queue/u);
  assert.match(html, /Library views/u);
  assert.match(html, /Connector coverage/u);
  assert.match(html, /Pending approval/u);
  assert.match(html, /app-nav__link/u);
  assert.match(html, /app-sidebar/u);
  assert.match(html, /app-main-header/u);
});
