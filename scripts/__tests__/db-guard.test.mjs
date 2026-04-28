/**
 * File header: Tests for the localhost DATABASE_URL guard used by db:reset.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isLocalDatabase } from "../lib/db-url.mjs";

test("isLocalDatabase recognizes loopback hosts", () => {
  assert.equal(isLocalDatabase("postgres://u:p@localhost:5432/db"), true);
  assert.equal(isLocalDatabase("postgres://u:p@127.0.0.1:5432/db"), true);
  assert.equal(isLocalDatabase("postgres://u:p@[::1]:5432/db"), true);
});

test("isLocalDatabase rejects remote hosts", () => {
  assert.equal(isLocalDatabase("postgres://u:p@db.production.example.com/db"), false);
  assert.equal(isLocalDatabase("postgres://u:p@10.0.0.4:5432/db"), false);
});

test("isLocalDatabase returns false for unparseable input", () => {
  assert.equal(isLocalDatabase("not a url"), false);
});
