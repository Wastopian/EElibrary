/**
 * File header: Tests for the local-env validation logic.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AUTH_SECRET_MIN_LENGTH, formatIssuesForStderr, validateLocalEnv } from "../lib/env-validate.mjs";

const VALID = {
  AUTH_SECRET: "x".repeat(AUTH_SECRET_MIN_LENGTH),
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  EE_LIBRARY_API_BASE_URL: "http://127.0.0.1:4000"
};

test("validateLocalEnv accepts a complete env", () => {
  assert.deepEqual(validateLocalEnv(VALID), []);
});

test("validateLocalEnv flags missing DATABASE_URL", () => {
  const issues = validateLocalEnv({ ...VALID, DATABASE_URL: "" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].key, "DATABASE_URL");
  assert.match(issues[0].fix, /setup:dev/u);
});

test("validateLocalEnv flags non-postgres DATABASE_URL protocol", () => {
  const issues = validateLocalEnv({ ...VALID, DATABASE_URL: "mysql://u:p@host/db" });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /protocol/u);
});

test("validateLocalEnv flags AUTH_SECRET shorter than the minimum", () => {
  const issues = validateLocalEnv({ ...VALID, AUTH_SECRET: "tooshort" });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /minimum is 32/u);
});

test("validateLocalEnv flags missing EE_LIBRARY_API_BASE_URL", () => {
  const issues = validateLocalEnv({ ...VALID, EE_LIBRARY_API_BASE_URL: "" });
  assert.equal(issues.length, 1);
  assert.match(issues[0].fix, /127\.0\.0\.1:4000/u);
});

test("validateLocalEnv flags non-http EE_LIBRARY_API_BASE_URL", () => {
  const issues = validateLocalEnv({ ...VALID, EE_LIBRARY_API_BASE_URL: "ftp://x" });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /protocol/u);
});

test("validateLocalEnv reports multiple issues at once", () => {
  const issues = validateLocalEnv({});
  const keys = issues.map((issue) => issue.key);
  assert.ok(keys.includes("DATABASE_URL"));
  assert.ok(keys.includes("AUTH_SECRET"));
  assert.ok(keys.includes("EE_LIBRARY_API_BASE_URL"));
});

test("formatIssuesForStderr returns empty string for an empty list", () => {
  assert.equal(formatIssuesForStderr([]), "");
});

test("formatIssuesForStderr emits actionable copy", () => {
  const issues = validateLocalEnv({});
  const text = formatIssuesForStderr(issues);
  assert.match(text, /missing required values/u);
  assert.match(text, /fix:/u);
});
