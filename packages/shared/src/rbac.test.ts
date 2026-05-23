/**
 * File header: Pins the RBAC v1 role/permission policy. The nested hierarchy
 * (viewer ⊂ contributor ⊂ approver ⊂ admin) and the "restrict no one" guarantees
 * (legacy `user` keeps full engineering power; `governance.admin` is admin-only) are
 * invariants the API authorization chokepoint depends on, so they are tested here.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_ROLES,
  ROLE_PERMISSIONS,
  isAppRole,
  roleHasPermission,
  type AppRole,
  type Permission
} from "./types";

test("isAppRole accepts every declared role and rejects everything else", () => {
  for (const role of APP_ROLES) {
    assert.equal(isAppRole(role), true, `${role} should be a valid role`);
  }

  for (const value of ["superadmin", "", "Admin", null, undefined, 7, {}]) {
    assert.equal(isAppRole(value), false, `${String(value)} should not be a valid role`);
  }
});

test("viewer is read-only", () => {
  assert.equal(roleHasPermission("viewer", "catalog.read"), true);
  assert.equal(roleHasPermission("viewer", "project.read"), true);
  assert.equal(roleHasPermission("viewer", "project.write"), false);
  assert.equal(roleHasPermission("viewer", "part.approve"), false);
  assert.equal(roleHasPermission("viewer", "governance.admin"), false);
});

test("contributor can edit project memory but not approve", () => {
  assert.equal(roleHasPermission("contributor", "project.write"), true);
  assert.equal(roleHasPermission("contributor", "part.import"), true);
  assert.equal(roleHasPermission("contributor", "part.approve"), false);
  assert.equal(roleHasPermission("contributor", "asset.promote_export"), false);
  assert.equal(roleHasPermission("contributor", "governance.admin"), false);
});

test("approver can sign off but is not a platform admin", () => {
  assert.equal(roleHasPermission("approver", "part.approve"), true);
  assert.equal(roleHasPermission("approver", "asset.review"), true);
  assert.equal(roleHasPermission("approver", "asset.promote_export"), true);
  assert.equal(roleHasPermission("approver", "governance.admin"), false);
});

test("admin holds every permission, including governance.admin", () => {
  const allPermissions: Permission[] = [
    "catalog.read",
    "project.read",
    "project.write",
    "part.import",
    "part.approve",
    "asset.review",
    "asset.promote_export",
    "governance.admin"
  ];

  for (const permission of allPermissions) {
    assert.equal(roleHasPermission("admin", permission), true, `admin should hold ${permission}`);
  }
});

test("legacy user keeps full engineering power but never platform administration", () => {
  // "restrict no one by default": existing `user` accounts must not lose engineering capability
  // when the role set widens. They are not granted governance.admin (role management stays admin).
  assert.equal(roleHasPermission("user", "project.write"), true);
  assert.equal(roleHasPermission("user", "part.approve"), true);
  assert.equal(roleHasPermission("user", "asset.promote_export"), true);
  assert.equal(roleHasPermission("user", "governance.admin"), false);
});

test("the role hierarchy is strictly nested: viewer ⊆ contributor ⊆ approver ⊆ admin", () => {
  const chain: AppRole[] = ["viewer", "contributor", "approver", "admin"];

  for (let i = 0; i < chain.length - 1; i += 1) {
    const lower = ROLE_PERMISSIONS[chain[i]!]!;
    const higher = new Set(ROLE_PERMISSIONS[chain[i + 1]!]!);

    for (const permission of lower) {
      assert.equal(higher.has(permission), true, `${chain[i + 1]} should include every ${chain[i]} permission (${permission})`);
    }
  }
});

test("only admin holds governance.admin", () => {
  for (const role of APP_ROLES) {
    const expected = role === "admin";
    assert.equal(roleHasPermission(role, "governance.admin"), expected, `${role} governance.admin should be ${expected}`);
  }
});

test("an unknown role grants nothing (fail closed)", () => {
  assert.equal(roleHasPermission("ghost" as AppRole, "catalog.read"), false);
});
