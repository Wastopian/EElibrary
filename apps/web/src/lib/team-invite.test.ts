/**
 * File header: Tests per-org teammate-invite helpers — code generation, normalization, the joining-user
 * record, and the Team-page view model.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildJoiningUserRecord, generateInviteCode, normalizeInviteCode, resolveTeamInviteView } from "./team-invite";

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
