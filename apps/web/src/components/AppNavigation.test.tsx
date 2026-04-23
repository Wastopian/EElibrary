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

  assert.match(html, /Catalog workspace/u);
  assert.match(html, /app-nav__link--active/u);
  assert.match(html, /Connector coverage/u);
  assert.match(html, /Missing verified CAD/u);
  assert.match(html, /Pending approval/u);
});

/**
 * Verifies the admin route is marked active when operators are inside the review workspace.
 */
test("app navigation marks the admin route as active inside admin pages", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/admin" />);

  assert.match(html, /Admin review queue/u);
  assert.match(html, /aria-current="page"/u);
});

/**
 * Verifies saved-view query links can mark active state on the homepage.
 */
test("app navigation marks the pending approval view as active when its filter is applied", () => {
  const html = renderToStaticMarkup(<AppNavigationLinks currentLocation="/?approvalStatus=pending_review" />);

  assert.match(html, /Pending approval/u);
  assert.match(html, /aria-current="page"/u);
});
