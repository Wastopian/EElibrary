/**
 * File header: Tests the pure RBAC v1 role-assignment guard.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseTeamRole, resolveRoleChange } from "./team-roles";

const BASE = {
  actingUserId: "admin-1",
  targetUserId: "member-2",
  targetCurrentRole: "user" as const,
  nextRole: "admin" as const,
  currentAdminCount: 1
};

test("resolveRoleChange allows promoting a read-only member to admin", () => {
  assert.deepEqual(resolveRoleChange(BASE), { ok: true });
});

test("resolveRoleChange allows demoting an admin while another admin remains", () => {
  const decision = resolveRoleChange({ ...BASE, targetCurrentRole: "admin", nextRole: "user", currentAdminCount: 2 });
  assert.deepEqual(decision, { ok: true });
});

test("resolveRoleChange refuses changing your own role", () => {
  const decision = resolveRoleChange({ ...BASE, targetUserId: "admin-1", targetCurrentRole: "admin", nextRole: "user", currentAdminCount: 2 });
  assert.equal(decision.ok, false);
  assert.match(decision.ok ? "" : decision.message, /your own role/iu);
});

test("resolveRoleChange refuses a no-op change", () => {
  const decision = resolveRoleChange({ ...BASE, targetCurrentRole: "user", nextRole: "user" });
  assert.equal(decision.ok, false);
  assert.match(decision.ok ? "" : decision.message, /already/iu);
});

test("resolveRoleChange never demotes the last admin", () => {
  const decision = resolveRoleChange({ ...BASE, targetCurrentRole: "admin", nextRole: "user", currentAdminCount: 1 });
  assert.equal(decision.ok, false);
  assert.match(decision.ok ? "" : decision.message, /at least one admin/iu);
});

test("parseTeamRole narrows to the assignable set", () => {
  assert.equal(parseTeamRole("admin"), "admin");
  assert.equal(parseTeamRole("user"), "user");
  assert.equal(parseTeamRole("viewer"), null);
  assert.equal(parseTeamRole(""), null);
  assert.equal(parseTeamRole(undefined), null);
});
