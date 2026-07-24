/**
 * File header: Regression tests for transactional teammate join (single-use invite + user insert).
 *
 * A failed user insert must not permanently burn a single-use invite token. These tests drive the
 * injectable join ops with an in-memory transaction so the rollback boundary stays locked in without
 * needing a live Postgres (Drizzle's node-pg driver is not compatible with pg-mem's type parsers).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { joinWithInviteOps, type JoinWithInviteOps } from "./join-with-invite";

test("joinWithInviteOps admits one account when consume + insert succeed inside the transaction", async () => {
  const state = { tokenConsumed: false, userOrgId: null as string | null };
  const ops = createMemoryJoinOps(state, { orgId: "org-acme" });

  const result = await joinWithInviteOps(ops);

  assert.equal(result, "joined");
  assert.equal(state.tokenConsumed, true);
  assert.equal(state.userOrgId, "org-acme");
});

test("joinWithInviteOps rolls the token back when user insert fails", async () => {
  const state = { tokenConsumed: false, userOrgId: null as string | null };
  const ops = createMemoryJoinOps(state, {
    insertError: new Error("duplicate key value violates unique constraint"),
    orgId: "org-acme"
  });

  await assert.rejects(() => joinWithInviteOps(ops), /duplicate key/);

  assert.equal(state.tokenConsumed, false, "a failed join must not burn the single-use invite");
  assert.equal(state.userOrgId, null);
});

test("joinWithInviteOps returns invite_not_found without inserting a user", async () => {
  const state = { tokenConsumed: false, userOrgId: null as string | null };
  const ops = createMemoryJoinOps(state, { orgId: null });

  const result = await joinWithInviteOps(ops);

  assert.equal(result, "invite_not_found");
  assert.equal(state.tokenConsumed, false);
  assert.equal(state.userOrgId, null);
});

test("joinWithInviteOps falls back to the reusable team code when the token miss", async () => {
  const state = { tokenConsumed: false, userOrgId: null as string | null };
  const ops = createMemoryJoinOps(state, { orgId: null, reusableOrgId: "org-from-code" });

  const result = await joinWithInviteOps(ops);

  assert.equal(result, "joined");
  assert.equal(state.tokenConsumed, false);
  assert.equal(state.userOrgId, "org-from-code");
});

/**
 * Builds an in-memory JoinWithInviteOps that rolls back consume/insert mutations when work throws.
 */
function createMemoryJoinOps(
  state: { tokenConsumed: boolean; userOrgId: string | null },
  options: {
    orgId: string | null;
    reusableOrgId?: string | null;
    insertError?: Error;
  }
): JoinWithInviteOps {
  return {
    runInTransaction: async (work) => {
      const snapshot = { tokenConsumed: state.tokenConsumed, userOrgId: state.userOrgId };

      try {
        await work();
      } catch (error) {
        state.tokenConsumed = snapshot.tokenConsumed;
        state.userOrgId = snapshot.userOrgId;
        throw error;
      }
    },
    consumeToken: async () => {
      if (!options.orgId) {
        return null;
      }

      state.tokenConsumed = true;
      return { orgId: options.orgId };
    },
    findOrgByReusableCode: async () => options.reusableOrgId ?? null,
    insertUser: async (orgId) => {
      if (options.insertError) {
        throw options.insertError;
      }

      state.userOrgId = orgId;
    }
  };
}
