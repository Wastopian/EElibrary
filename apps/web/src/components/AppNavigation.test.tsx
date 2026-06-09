/**
 * File header: Tests the global application navigation active-state behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppNavigationLinks } from "./AppNavigation";

/**
 * Verifies the catalog route is marked active when operators are on the homepage workspace.
 */
test("app navigation marks the catalog workspace as active on the homepage", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/" />);

  assert.match(html, /Catalog/u);
  assert.match(html, /app-nav__link--active/u);
  assert.match(html, /Connectors/u);
  assert.match(html, /Missing CAD/u);
  assert.match(html, /Pending review/u);
});

/**
 * Verifies the admin route is marked active when operators are inside the review workspace.
 */
test("app navigation marks the admin route as active inside admin pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/admin" />);

  assert.match(html, /Admin/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Verifies the project-memory route is visible and active inside project pages.
 */
test("app navigation marks the projects route as active inside project memory pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/projects/project-alpha" />);

  assert.match(html, /Projects/u);
  assert.match(html, /Open your project list and BOM history/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Part detail is its own route; catalog should not claim aria-current=page there.
 */
test("app navigation does not mark catalog active on part detail pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/parts/part-tps7a02dbvr" />);

  assert.match(html, /Catalog/u);
  assert.doesNotMatch(html, /href="\/catalog"[^>]*aria-current="page"/u);
  assert.doesNotMatch(html, /href="\/"[^>]*aria-current="page"/u);
});

/**
 * Verifies the vendor notebook route is present and active for vendor pages.
 */
test("app navigation marks the vendors route as active inside vendor notebook pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/vendors/jlcpcb" />);

  assert.match(html, /Vendors/u);
  assert.match(html, /Remember PCB shops, sheet metal, and who you trust/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Verifies the tools workspace is visible and active inside calculator pages.
 */
test("app navigation marks the tools route as active inside the calculator workspace", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/tools" />);

  assert.match(html, /Tools/u);
  assert.match(html, /Quick EE math/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Verifies the system-health workspace is visible and active for operational review.
 */
test("app navigation marks the system route as active inside system health pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/system" />);

  assert.match(html, /System/u);
  assert.match(html, /Check service status and health/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Verifies saved-view query links can mark active state on the homepage.
 */
test("app navigation marks the pending approval view as active when its filter is applied", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/?approvalStatus=pending_review" />);

  assert.match(html, /Pending review/u);
  assert.match(html, /aria-current="page"/u);
});
