/**
 * File header: Tests the local admin seed helper without connecting to a real database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { compareSync } from "bcryptjs";

import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  parseSeedAdminArgs,
  seedAdminUser
} from "../seed-admin.mjs";

test("parseSeedAdminArgs keeps safe local defaults", () => {
  const parsed = parseSeedAdminArgs([]);

  assert.equal(parsed.email, DEFAULT_ADMIN_EMAIL);
  assert.equal(parsed.password, DEFAULT_ADMIN_PASSWORD);
  assert.equal(parsed.resetPassword, false);
  assert.equal(parsed.force, false);
});

test("parseSeedAdminArgs accepts explicit admin bootstrap flags", () => {
  const parsed = parseSeedAdminArgs([
    "--email",
    "Admin@Example.test",
    "--password",
    "long-enough-password",
    "--id",
    "00000000-0000-4000-8000-000000000123",
    "--reset-password",
    "--force"
  ]);

  assert.deepEqual(parsed, {
    email: "Admin@Example.test",
    force: true,
    id: "00000000-0000-4000-8000-000000000123",
    password: "long-enough-password",
    resetPassword: true
  });
});

test("seedAdminUser inserts a bcrypt-backed admin row when missing", async () => {
  const client = makeFakeClient([]);
  const result = await seedAdminUser(client, {
    email: DEFAULT_ADMIN_EMAIL,
    id: "00000000-0000-4000-8000-000000000001",
    password: DEFAULT_ADMIN_PASSWORD,
    resetPassword: false
  });
  const insert = client.queries.find((query) => query.text.includes("INSERT INTO users"));

  assert.equal(result.status, "created");
  assert.ok(insert, "expected insert query");
  assert.equal(insert.values[0], "00000000-0000-4000-8000-000000000001");
  assert.equal(insert.values[1], DEFAULT_ADMIN_EMAIL);
  assert.equal(compareSync(DEFAULT_ADMIN_PASSWORD, insert.values[2]), true);
});

test("seedAdminUser leaves an existing admin untouched without reset", async () => {
  const client = makeFakeClient([{ email: DEFAULT_ADMIN_EMAIL, id: "existing-id", role: "admin" }]);
  const result = await seedAdminUser(client, {
    email: DEFAULT_ADMIN_EMAIL,
    password: DEFAULT_ADMIN_PASSWORD,
    resetPassword: false
  });

  assert.equal(result.status, "exists");
  assert.equal(result.passwordChanged, false);
  assert.equal(client.queries.some((query) => query.text.includes("UPDATE users")), false);
});

test("seedAdminUser promotes an existing local user and rotates to the requested admin password", async () => {
  const client = makeFakeClient([{ email: DEFAULT_ADMIN_EMAIL, id: "existing-id", role: "user" }]);
  const result = await seedAdminUser(client, {
    email: DEFAULT_ADMIN_EMAIL,
    password: DEFAULT_ADMIN_PASSWORD,
    resetPassword: false
  });
  const update = client.queries.find((query) => query.text.includes("UPDATE users"));

  assert.equal(result.status, "updated");
  assert.equal(result.passwordChanged, true);
  assert.equal(result.roleChanged, true);
  assert.ok(update, "expected role promotion query");
  assert.match(update.text, /password_hash = \$2/u);
  assert.match(update.text, /role = 'admin'/u);
  assert.equal(update.values[0], DEFAULT_ADMIN_EMAIL);
  assert.equal(compareSync(DEFAULT_ADMIN_PASSWORD, update.values[1]), true);
});

test("seedAdminUser rotates an existing admin password only when reset is explicit", async () => {
  const client = makeFakeClient([{ email: DEFAULT_ADMIN_EMAIL, id: "existing-id", role: "admin" }]);
  const result = await seedAdminUser(client, {
    email: DEFAULT_ADMIN_EMAIL,
    password: "rotated-local-password",
    resetPassword: true
  });
  const update = client.queries.find((query) => query.text.includes("UPDATE users"));

  assert.equal(result.status, "updated");
  assert.equal(result.passwordChanged, true);
  assert.ok(update, "expected update query");
  assert.equal(update.values[0], DEFAULT_ADMIN_EMAIL);
  assert.equal(compareSync("rotated-local-password", update.values[1]), true);
});

/**
 * Builds a minimal fake pg client that records queries and returns a scripted user lookup.
 */
function makeFakeClient(selectRows) {
  return {
    queries: [],
    async query(text, values = []) {
      this.queries.push({ text, values });

      if (text.includes("SELECT id, email, role FROM users")) {
        return { rowCount: selectRows.length, rows: selectRows };
      }

      return { rowCount: 1, rows: [] };
    }
  };
}
