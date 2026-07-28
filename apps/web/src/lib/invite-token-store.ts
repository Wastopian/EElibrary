/**
 * File header: Single-use, expiring invite-token persistence over the shared Drizzle pool.
 *
 * The consume UPDATE is race-free for "one token, one winner": it marks the token spent only if it is
 * still unconsumed, unrevoked, and unexpired, and RETURNs the org. Callers that also create a user
 * (sign-up join) MUST run consume + insert inside one transaction via `joinWithInvite` — otherwise a
 * failed insert permanently burns the token without admitting anyone. Generation, listing, and
 * revocation are always org-scoped by the caller's session org, never by input.
 */

import { generateInviteToken } from "@/lib/team-invite";
import { orgInviteTokens, type DbPool } from "@ee-library/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/** ActiveInviteToken is one still-usable token as the Team page lists it. */
export interface ActiveInviteToken {
  id: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Inserts one single-use token for an org and returns it. The unique index on `token` guards the
 * astronomically unlikely collision; the caller supplies the expiry so issuance stays testable.
 */
export async function createInviteToken(
  db: DbPool,
  input: { orgId: string; createdBy: string | null; expiresAt: Date }
): Promise<ActiveInviteToken> {
  const token = generateInviteToken();
  const id = `invtok-${randomUUID()}`;
  const createdAt = new Date();

  await db.insert(orgInviteTokens).values({
    id,
    orgId: input.orgId,
    token,
    createdBy: input.createdBy,
    createdAt,
    expiresAt: input.expiresAt,
  });

  return { id, token, createdAt, expiresAt: input.expiresAt };
}

/**
 * Lists an org's tokens that are still usable right now: unconsumed, unrevoked, and unexpired.
 */
export async function listActiveInviteTokens(db: DbPool, orgId: string, now: Date = new Date()): Promise<ActiveInviteToken[]> {
  const rows = await db
    .select({
      id: orgInviteTokens.id,
      token: orgInviteTokens.token,
      createdAt: orgInviteTokens.createdAt,
      expiresAt: orgInviteTokens.expiresAt,
    })
    .from(orgInviteTokens)
    .where(
      and(
        eq(orgInviteTokens.orgId, orgId),
        isNull(orgInviteTokens.consumedAt),
        isNull(orgInviteTokens.revokedAt),
        gt(orgInviteTokens.expiresAt, now)
      )
    )
    .orderBy(desc(orgInviteTokens.createdAt));

  return rows;
}

/**
 * Revokes one unconsumed token, scoped to the org so a member can only ever revoke their own team's
 * tokens. Returns true when a matching still-revocable row was updated.
 */
export async function revokeInviteToken(db: DbPool, input: { tokenId: string; orgId: string }): Promise<boolean> {
  const updated = await db
    .update(orgInviteTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(orgInviteTokens.id, input.tokenId),
        eq(orgInviteTokens.orgId, input.orgId),
        isNull(orgInviteTokens.consumedAt),
        isNull(orgInviteTokens.revokedAt)
      )
    )
    .returning({ id: orgInviteTokens.id });

  return updated.length > 0;
}

/**
 * Atomically consumes one single-use token and returns the org to join, or null when the token is
 * unknown, already consumed, revoked, or expired. Race-free by construction: the conditional UPDATE
 * is the sole gate, so two accounts cannot redeem the same token.
 */
export async function consumeInviteToken(db: DbPool, input: { token: string; email: string }): Promise<{ orgId: string } | null> {
  const now = new Date();
  const consumed = await db
    .update(orgInviteTokens)
    .set({ consumedAt: now, consumedByEmail: input.email })
    .where(
      and(
        eq(orgInviteTokens.token, input.token),
        isNull(orgInviteTokens.consumedAt),
        isNull(orgInviteTokens.revokedAt),
        gt(orgInviteTokens.expiresAt, now)
      )
    )
    .returning({ orgId: orgInviteTokens.orgId });

  return consumed[0] ?? null;
}
