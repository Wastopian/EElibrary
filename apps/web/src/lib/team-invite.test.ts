/**
 * File header: Tests per-org teammate-invite helpers — code generation, normalization, the joining-user
 * record, and the Team-page view model.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildJoiningUserRecord, computeInviteTokenExpiry, decideInviteTokenState, generateInviteCode, generateInviteToken, normalizeInviteCode, normalizeInviteValue, resolveTeamInviteView } from "./team-invite";

test("generateInviteCode produces a readable, unambiguous code", () => {
  const code = generateInviteCode();

  // TEAM- prefix + two 4-char groups from the ambiguity-free alphabet (no I, L, O, U).
  assert.match(code, /^TEAM-[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}$/u);
});

test("generateInviteCode is distinct across calls", () => {
  const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
  assert.equal(codes.size, 20, "20 generated codes are all different");
});

test("normalizeInviteCode trims and uppercases for tolerant lookup", () => {
  assert.equal(normalizeInviteCode("  team-7f3k-92ab  "), "TEAM-7F3K-92AB");
  assert.equal(normalizeInviteCode("TEAM-7F3K-92AB"), "TEAM-7F3K-92AB");
});

test("buildJoiningUserRecord adds a full-access admin to the resolved org", () => {
  const record = buildJoiningUserRecord({ email: "dana@acme.test", orgId: "org-1a2b3c", passwordHash: "hash" });

  assert.equal(record.email, "dana@acme.test");
  assert.equal(record.passwordHash, "hash");
  assert.equal(record.role, "admin", "teammates join with full access");
  assert.equal(record.orgId, "org-1a2b3c", "the org comes from the resolved invite");
  assert.match(record.id, /[0-9a-f-]{36}/u, "a fresh user id is generated");
});

test("resolveTeamInviteView flags orgs that still need a code", () => {
  assert.deepEqual(resolveTeamInviteView({ inviteCode: "TEAM-7F3K-92AB", name: "Acme" }), {
    inviteCode: "TEAM-7F3K-92AB",
    needsGeneration: false,
    teamName: "Acme"
  });
  assert.deepEqual(resolveTeamInviteView({ inviteCode: null, name: "Default Team" }), {
    inviteCode: null,
    needsGeneration: true,
    teamName: "Default Team"
  });
});

test("generateInviteToken produces a longer, unambiguous single-use token", () => {
  const token = generateInviteToken();

  // INV- prefix + three 5-char groups from the ambiguity-free alphabet (no I, L, O, U).
  assert.match(token, /^INV-[0-9A-HJ-NP-TV-Z]{5}-[0-9A-HJ-NP-TV-Z]{5}-[0-9A-HJ-NP-TV-Z]{5}$/u);
});

test("generateInviteToken is distinct across calls", () => {
  const tokens = new Set(Array.from({ length: 20 }, () => generateInviteToken()));
  assert.equal(tokens.size, 20, "20 generated tokens are all different");
});

test("computeInviteTokenExpiry adds the TTL and clamps to a sane window", () => {
  const now = new Date("2026-07-19T00:00:00.000Z");

  assert.equal(computeInviteTokenExpiry(now).toISOString(), "2026-07-26T00:00:00.000Z", "default is 7 days out");
  assert.equal(computeInviteTokenExpiry(now, 1).toISOString(), "2026-07-20T00:00:00.000Z");
  // Below the floor and above the ceiling both clamp rather than producing an absurd expiry.
  assert.equal(computeInviteTokenExpiry(now, 0).toISOString(), "2026-07-20T00:00:00.000Z", "clamped up to 1 day");
  assert.equal(computeInviteTokenExpiry(now, 9999).toISOString(), "2026-10-17T00:00:00.000Z", "clamped down to 90 days");
});

test("decideInviteTokenState ranks revoked and consumed above expiry", () => {
  const now = new Date("2026-07-19T00:00:00.000Z");
  const future = new Date("2026-07-26T00:00:00.000Z");
  const past = new Date("2026-07-12T00:00:00.000Z");

  assert.equal(decideInviteTokenState({ token: "t", expiresAt: future, consumedAt: null, revokedAt: null }, now), "valid");
  assert.equal(decideInviteTokenState({ token: "t", expiresAt: past, consumedAt: null, revokedAt: null }, now), "expired");
  assert.equal(decideInviteTokenState({ token: "t", expiresAt: future, consumedAt: now, revokedAt: null }, now), "consumed");
  assert.equal(decideInviteTokenState({ token: "t", expiresAt: future, consumedAt: null, revokedAt: now }, now), "revoked");
  // A revoked token that is also expired reads as revoked (the actionable reason), consumed wins over expiry too.
  assert.equal(decideInviteTokenState({ token: "t", expiresAt: past, consumedAt: null, revokedAt: now }, now), "revoked");
  assert.equal(decideInviteTokenState({ token: "t", expiresAt: past, consumedAt: now, revokedAt: null }, now), "consumed");
});

test("normalizeInviteValue trims and upper-cases so tokens and codes share one rule", () => {
  assert.equal(normalizeInviteValue("  inv-abc12-def34-ghj56 "), "INV-ABC12-DEF34-GHJ56");
  assert.equal(normalizeInviteValue("team-7f3k-92ab"), "TEAM-7F3K-92AB");
});
