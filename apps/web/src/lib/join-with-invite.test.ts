/**
 * File header: Regression tests for transactional teammate join (single-use invite + user insert).
 *
 * A failed user insert must not permanently burn a single-use invite token. These tests drive the
 * real Drizzle helpers against pg-mem so the consume+insert transaction boundary stays locked in.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { newDb } from "pg-mem";
import { orgInviteTokens, organizations, users, type DbPool } from "@ee-library/db";
import { eq } from "drizzle-orm";
import { joinWithInvite } from "./join-with-invite";

test("joinWithInvite admits one account and spends the single-use token", async () => {
  const { db, pool } = createJoinInviteDb();

  try {
    await seedOrgAndToken(db, {
      email: null,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      orgId: "org-acme",
      token: "INV-7F3K9-2AB4C-QRS8T"
    });

    const result = await joinWithInvite(db, {
      email: "dana@acme.test",
      inviteValue: "INV-7F3K9-2AB4C-QRS8T",
      passwordHash: "hash"
    });

    assert.equal(result, "joined");

    const [token] = await db
      .select({ consumedAt: orgInviteTokens.consumedAt, consumedByEmail: orgInviteTokens.consumedByEmail })
      .from(orgInviteTokens)
      .where(eq(orgInviteTokens.token, "INV-7F3K9-2AB4C-QRS8T"));
    const [user] = await db.select({ email: users.email, orgId: users.orgId, role: users.role }).from(users);

    assert.ok(token?.consumedAt, "successful join spends the token");
    assert.equal(token?.consumedByEmail, "dana@acme.test");
    assert.equal(user?.email, "dana@acme.test");
    assert.equal(user?.orgId, "org-acme");
    assert.equal(user?.role, "admin");
  } finally {
    await pool.end();
  }
});

test("joinWithInvite rolls the token back when user insert fails", async () => {
  const { db, pool } = createJoinInviteDb();

  try {
    await seedOrgAndToken(db, {
      email: null,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      orgId: "org-acme",
      token: "INV-ABC12-DEF34-GHJ56"
    });
    // Pre-existing account with the same email makes the joining insert hit the unique constraint.
    await db.insert(users).values({
      email: "taken@acme.test",
      id: "11111111-1111-4111-8111-111111111111",
      orgId: "org-acme",
      passwordHash: "existing",
      role: "admin"
    });

    await assert.rejects(
      () =>
        joinWithInvite(db, {
          email: "taken@acme.test",
          inviteValue: "INV-ABC12-DEF34-GHJ56",
          passwordHash: "hash"
        }),
      /unique|duplicate|23505/i
    );

    const [token] = await db
      .select({ consumedAt: orgInviteTokens.consumedAt })
      .from(orgInviteTokens)
      .where(eq(orgInviteTokens.token, "INV-ABC12-DEF34-GHJ56"));

    assert.equal(token?.consumedAt, null, "a failed join must not burn the single-use invite");
  } finally {
    await pool.end();
  }
});

test("joinWithInvite returns invite_not_found for an unknown value without inserting a user", async () => {
  const { db, pool } = createJoinInviteDb();

  try {
    await db.insert(organizations).values({ id: "org-acme", name: "Acme", inviteCode: "TEAM-7F3K-92AB" });

    const result = await joinWithInvite(db, {
      email: "dana@acme.test",
      inviteValue: "INV-DOES1-NOT22-EXIST",
      passwordHash: "hash"
    });

    assert.equal(result, "invite_not_found");
    const members = await db.select({ id: users.id }).from(users);
    assert.equal(members.length, 0);
  } finally {
    await pool.end();
  }
});

/**
 * Creates a minimal Drizzle-backed pg-mem database for invite join tests.
 */
function createJoinInviteDb(): { db: DbPool; pool: { end: () => Promise<void> } } {
  const memory = newDb({ autoCreateForeignKeyIndices: true });

  memory.public.none(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      invite_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      org_id TEXT REFERENCES organizations(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE org_invite_tokens (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      token TEXT NOT NULL UNIQUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      consumed_by_email TEXT,
      revoked_at TIMESTAMPTZ
    );
  `);

  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const db = drizzle(pool) as unknown as DbPool;

  return { db, pool };
}

/**
 * Seeds one org plus one still-usable single-use invite token.
 */
async function seedOrgAndToken(
  db: DbPool,
  input: { orgId: string; token: string; expiresAt: Date; email: string | null }
): Promise<void> {
  await db.insert(organizations).values({ id: input.orgId, name: "Acme", inviteCode: "TEAM-7F3K-92AB" });
  await db.insert(orgInviteTokens).values({
    consumedByEmail: input.email,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: input.expiresAt,
    id: `invtok-${input.token}`,
    orgId: input.orgId,
    token: input.token
  });
}
