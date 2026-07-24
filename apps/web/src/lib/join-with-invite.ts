/**
 * File header: Transactional teammate join via single-use invite token or reusable team code.
 *
 * The consume path alone is race-free for "one token, one winner", but sign-up must still create the
 * user row. If those steps are separate, a failed insert (duplicate email race, transient DB error)
 * permanently burns a single-use token without admitting anyone. This helper keeps consume + insert
 * in one Postgres transaction so a failed join rolls the token back to usable.
 */

import { buildJoiningUserRecord } from "@/lib/team-invite";
import { consumeInviteToken } from "@/lib/invite-token-store";
import { organizations, users, type DbPool } from "@ee-library/db";
import { eq } from "drizzle-orm";

/** JoinWithInviteInput is the validated join form payload after password hashing. */
export interface JoinWithInviteInput {
  inviteValue: string;
  email: string;
  passwordHash: string;
}

/** JoinWithInviteResult is the narrow outcome the sign-up action maps to user-facing errors. */
export type JoinWithInviteResult = "joined" | "invite_not_found";

/** Sentinel so a missing invite aborts the transaction without looking like a setup failure. */
class InviteNotFoundError extends Error {
  constructor() {
    super("invite_not_found");
    this.name = "InviteNotFoundError";
  }
}

/**
 * Joins the resolved organization by consuming a single-use token (preferred) or matching the
 * reusable team code, then inserting the user — all in one transaction.
 */
export async function joinWithInvite(db: DbPool, input: JoinWithInviteInput): Promise<JoinWithInviteResult> {
  try {
    await db.transaction(async (tx) => {
      // Drizzle's transaction client supports the same query builders the store helpers use.
      const tokenDb = tx as unknown as DbPool;
      const consumed = await consumeInviteToken(tokenDb, { token: input.inviteValue, email: input.email });
      const joinOrgId =
        consumed?.orgId ??
        (
          await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.inviteCode, input.inviteValue))
            .limit(1)
        )[0]?.id ??
        null;

      if (!joinOrgId) {
        throw new InviteNotFoundError();
      }

      await tx.insert(users).values(
        buildJoiningUserRecord({
          email: input.email,
          orgId: joinOrgId,
          passwordHash: input.passwordHash
        })
      );
    });

    return "joined";
  } catch (error) {
    if (error instanceof InviteNotFoundError) {
      return "invite_not_found";
    }

    throw error;
  }
}
