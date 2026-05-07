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
  assert.match(html, /Open internal project memory and persisted BOM usage/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Verifies the system-health workspace is visible and active for operational review.
 */
test("app navigation marks the system route as active inside system health pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/system" />);

  assert.match(html, /System/u);
  assert.match(html, /Check API, database, worker, storage, and queued-job health/u);
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
