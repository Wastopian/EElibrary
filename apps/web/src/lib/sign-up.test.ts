/**
 * File header: Tests org-on-signup helpers — team-name normalization and the new-team record shape.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildNewTeamRecords, MAX_TEAM_NAME_LENGTH, normalizeTeamName } from "./sign-up";

test("normalizeTeamName trims and accepts a usable team name", () => {
  assert.equal(normalizeTeamName("  Acme Instruments  "), "Acme Instruments");
  assert.equal(normalizeTeamName("A"), "A");
});

test("normalizeTeamName rejects empty, whitespace-only, and over-long names", () => {
  assert.equal(normalizeTeamName(""), null);
  assert.equal(normalizeTeamName("   "), null);
  assert.equal(normalizeTeamName("x".repeat(MAX_TEAM_NAME_LENGTH + 1)), null);
  // The maximum length itself is allowed.
  assert.equal(normalizeTeamName("x".repeat(MAX_TEAM_NAME_LENGTH))?.length, MAX_TEAM_NAME_LENGTH);
});

test("buildNewTeamRecords makes the signer the admin of a fresh org", () => {
  const records = buildNewTeamRecords({
    email: "lead@acme.test",
    passwordHash: "hash-value",
    teamName: "Acme Instruments"
  });

  assert.match(records.organization.id, /^org-[0-9a-f]{8}$/u, "org id is generated, not org-default");
  assert.equal(records.organization.name, "Acme Instruments", "the org is named from the form field");
  assert.equal(records.organization.slug, records.organization.id, "slug reuses the unique org id");

  assert.equal(records.user.email, "lead@acme.test");
  assert.equal(records.user.passwordHash, "hash-value");
  assert.equal(records.user.role, "admin", "the first user of a team owns it");
  assert.equal(records.user.orgId, records.organization.id, "the user joins the org it just created");
  assert.notEqual(records.user.id, records.organization.id, "user and org ids are distinct");
});

test("buildNewTeamRecords gives each sign-up its own distinct organization", () => {
  const first = buildNewTeamRecords({ email: "a@x.test", passwordHash: "h", teamName: "Team A" });
  const second = buildNewTeamRecords({ email: "b@y.test", passwordHash: "h", teamName: "Team B" });

  assert.notEqual(first.organization.id, second.organization.id, "two sign-ups never share an org id");
});
