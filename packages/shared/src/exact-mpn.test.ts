/**
 * File header: Tests for the looksLikeExactMpn / classifyExactMpn / normalizeExactMpn helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { classifyExactMpn, looksLikeExactMpn, normalizeExactMpn } from "./exact-mpn";

test("looksLikeExactMpn accepts seeded canonical MPNs", () => {
  assert.equal(looksLikeExactMpn("TPS7A02DBVR"), true);
  assert.equal(looksLikeExactMpn("STM32G031K8T6"), true);
  assert.equal(looksLikeExactMpn("GRM188R71C104KA01D"), true);
});

test("looksLikeExactMpn accepts MPNs with internal dashes and lowercase", () => {
  assert.equal(looksLikeExactMpn("LM358-DR"), true);
  assert.equal(looksLikeExactMpn("tps7a02dbvr"), true);
});

test("looksLikeExactMpn rejects vague keyword searches", () => {
  assert.equal(looksLikeExactMpn(""), false);
  assert.equal(looksLikeExactMpn("regulator"), false);
  assert.equal(looksLikeExactMpn("low dropout regulator"), false);
  assert.equal(looksLikeExactMpn("3v3 LDO"), false);
});

test("looksLikeExactMpn rejects pure-digit codes that look like packages", () => {
  assert.equal(looksLikeExactMpn("0603"), false);
  assert.equal(looksLikeExactMpn("12345"), false);
});

test("looksLikeExactMpn rejects pure-letter words that look like packages or categories", () => {
  assert.equal(looksLikeExactMpn("QFN"), false);
  assert.equal(looksLikeExactMpn("MOSFET"), false);
});

test("looksLikeExactMpn rejects too-short inputs even when shaped like MPNs", () => {
  assert.equal(looksLikeExactMpn("A1"), false);
  assert.equal(looksLikeExactMpn("X12"), false);
});

test("looksLikeExactMpn rejects strings with whitespace", () => {
  assert.equal(looksLikeExactMpn("STM 32G031"), false);
  assert.equal(looksLikeExactMpn("  TPS7A02"), true, "leading/trailing whitespace is trimmed and ignored");
});

test("looksLikeExactMpn rejects strings with disallowed punctuation", () => {
  assert.equal(looksLikeExactMpn("0.1uF"), false);
  assert.equal(looksLikeExactMpn("STM32/G031"), false);
});

test("classifyExactMpn explains the rejection reason", () => {
  assert.equal(classifyExactMpn("regulator").reason, "missing_digit");
  assert.equal(classifyExactMpn("123456").reason, "missing_letter");
  assert.equal(classifyExactMpn("0603").reason, "too_short");
  assert.equal(classifyExactMpn("ABC").reason, "too_short");
  assert.equal(classifyExactMpn("STM 32").reason, "contains_whitespace");
  assert.equal(classifyExactMpn("0.1uF").reason, "invalid_characters");
  assert.equal(classifyExactMpn("").reason, "empty");
  assert.equal(classifyExactMpn("TPS7A02DBVR").reason, "ok");
});

test("normalizeExactMpn returns uppercase MPN or null", () => {
  assert.equal(normalizeExactMpn("tps7a02dbvr"), "TPS7A02DBVR");
  assert.equal(normalizeExactMpn("regulator"), null);
  assert.equal(normalizeExactMpn(""), null);
});
