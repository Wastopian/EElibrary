/**
 * File header: Verifies tenant id namespacing keeps org-default on legacy ids and isolates other orgs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ORG_ID, scopeEntityId } from "./tenant";

test("scopeEntityId keeps the legacy id for org-default", () => {
  assert.equal(scopeEntityId(DEFAULT_ORG_ID, "project-alpha"), "project-alpha");
  assert.equal(scopeEntityId("org-default", "part-digikey-abc"), "part-digikey-abc");
});

test("scopeEntityId namespaces non-default orgs so the same natural key never collides", () => {
  const legacy = "cblock-usb-protect";
  const orgA = scopeEntityId("org-1a2b3c", legacy);
  const orgB = scopeEntityId("org-9z8y7x", legacy);

  assert.equal(orgA, "org-1a2b3c__cblock-usb-protect");
  assert.equal(orgB, "org-9z8y7x__cblock-usb-protect");
  assert.notEqual(orgA, orgB, "distinct orgs derive distinct ids from the same key");
  assert.notEqual(orgA, legacy, "a non-default org never reuses the legacy id");
});
