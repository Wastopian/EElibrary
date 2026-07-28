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

/**
 * JoinWithInviteOps is the injectable seam used by focused regression tests. Production wires these
 * to a real Drizzle transaction; tests supply an in-memory transaction that rolls back on throw.
 */
export interface JoinWithInviteOps {
  runInTransaction: (work: () => Promise<void>) => Promise<void>;
  consumeToken: () => Promise<{ orgId: string } | null>;
  findOrgByReusableCode: () => Promise<string | null>;
  insertUser: (orgId: string) => Promise<void>;
}

/** Sentinel so a missing invite aborts the transaction without looking like a setup failure. */
class InviteNotFoundError extends Error {
  constructor() {
    super("invite_not_found");
    this.name = "InviteNotFoundError";
  }
}

/**
 * Runs the join workflow through injectable ops so consume + insert share one transactional boundary.
 */
export async function joinWithInviteOps(ops: JoinWithInviteOps): Promise<JoinWithInviteResult> {
  try {
    await ops.runInTransaction(async () => {
      const consumed = await ops.consumeToken();
      const joinOrgId = consumed?.orgId ?? (await ops.findOrgByReusableCode());

      if (!joinOrgId) {
        throw new InviteNotFoundError();
      }

      await ops.insertUser(joinOrgId);
    });

    return "joined";
  } catch (error) {
    if (error instanceof InviteNotFoundError) {
      return "invite_not_found";
    }

    throw error;
  }
}

/**
 * Joins the resolved organization by consuming a single-use token (preferred) or matching the
 * reusable team code, then inserting the user — all in one transaction.
 */
export async function joinWithInvite(db: DbPool, input: JoinWithInviteInput): Promise<JoinWithInviteResult> {
  try {
    await db.transaction(async (tx) => {
      const tokenDb = tx as unknown as DbPool;
      const consumed = await consumeInviteToken(tokenDb, { token: input.inviteValue, email: input.email });
      const joinOrgId =
        consumed?.orgId ??
        (
          await tokenDb
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.inviteCode, input.inviteValue))
            .limit(1)
        )[0]?.id ??
        null;

      if (!joinOrgId) {
        throw new InviteNotFoundError();
      }

      await tokenDb.insert(users).values(
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
