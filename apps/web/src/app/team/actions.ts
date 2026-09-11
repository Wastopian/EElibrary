"use server";

/**
 * File header: Team member administration — admin-mediated password reset.
 *
 * Team servers have no email service, so "forgot password" cannot be a self-service email link.
 * Instead, any team admin can reset a teammate's password from the Team page and hand over the
 * generated temporary password directly (it is returned to the admin's screen exactly once and
 * never travels in a URL). The teammate signs in with it and picks a new password on /account.
 */

import { auth } from "@/auth";
import { generateTemporaryPassword } from "@/lib/account";
import { readLiveSessionRole } from "@/lib/live-session-role";
import { canAdministerTeam, parseTeamRole, resolveRoleChange, type TeamRole } from "@/lib/team-roles";
import { createDbPool, users } from "@ee-library/db";
import { hashSync } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/** BCRYPT_COST matches sign-up and the local admin seed so all credential records verify alike. */
const BCRYPT_COST = 12;

/** DEFAULT_DATABASE_URL keeps local development auth usable when the env var is omitted. */
const DEFAULT_DATABASE_URL = "postgres://ee_library:ee_library@localhost:5432/ee_library";

/** ResetMemberPasswordResult reports the one-time temporary password or a plain-language failure. */
export type ResetMemberPasswordResult =
  | { status: "reset"; email: string; temporaryPassword: string }
  | { status: "failed"; message: string };

/**
 * Resets one teammate's password to a fresh temporary value. Admin-only and strictly org-scoped:
 * the target must belong to the acting admin's own team.
 */
export async function resetMemberPasswordAction(memberId: string): Promise<ResetMemberPasswordResult> {
  const session = await auth();

  if (!session?.user?.id) {
    return { status: "failed", message: "Your session has expired. Sign in again, then retry." };
  }

  try {
    // Prefer the live users.role row over the JWT claim — demotion must take effect without a re-login.
    const live = await readLiveSessionRole(session.user.id);

    if (!live || live.orgId !== session.user.orgId || !canAdministerTeam(live.role)) {
      return { status: "failed", message: "Only a team admin can reset a teammate's password." };
    }

    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    const [target] = await db
      .select({ email: users.email, orgId: users.orgId })
      .from(users)
      .where(eq(users.id, memberId))
      .limit(1);

    // Same failure shape whether the id is unknown or belongs to another team: the org boundary
    // must not be probeable from here.
    if (!target || (target.orgId ?? "org-default") !== live.orgId) {
      return { status: "failed", message: "That person is not a member of your team." };
    }

    const temporaryPassword = generateTemporaryPassword();
    await db.update(users).set({ passwordHash: hashSync(temporaryPassword, BCRYPT_COST) }).where(eq(users.id, memberId));

    return { status: "reset", email: target.email, temporaryPassword };
  } catch {
    return { status: "failed", message: "The user database is not reachable right now. Try again, or check the System page." };
  }
}

/** SetMemberRoleResult reports the applied role change or a plain-language failure. */
export type SetMemberRoleResult =
  | { status: "updated"; email: string; role: TeamRole }
  | { status: "failed"; message: string };

/**
 * Sets one teammate's role (admin or read-only). Admin-only and strictly org-scoped; the pure guard
 * in `resolveRoleChange` refuses self-changes, no-ops, and demoting the org's last admin. The admin
 * count is read inside the same org so the last-admin check cannot be raced past a cross-tenant read.
 */
export async function setMemberRoleAction(memberId: string, nextRoleValue: string): Promise<SetMemberRoleResult> {
  const session = await auth();

  if (!session?.user?.id) {
    return { status: "failed", message: "Your session has expired. Sign in again, then retry." };
  }

  const nextRole = parseTeamRole(nextRoleValue);

  if (!nextRole) {
    return { status: "failed", message: "Choose a valid role." };
  }

  try {
    // Prefer the live users.role row over the JWT claim — demotion must take effect without a re-login.
    const live = await readLiveSessionRole(session.user.id);

    if (!live || live.orgId !== session.user.orgId || !canAdministerTeam(live.role)) {
      return { status: "failed", message: "Only a team admin can change a teammate's role." };
    }

    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    const orgId = live.orgId;
    const [target] = await db
      .select({ email: users.email, orgId: users.orgId, role: users.role })
      .from(users)
      .where(eq(users.id, memberId))
      .limit(1);

    // Same failure shape whether unknown or foreign: the org boundary must not be probeable here.
    if (!target || (target.orgId ?? "org-default") !== orgId) {
      return { status: "failed", message: "That person is not a member of your team." };
    }

    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.role, "admin")));

    const decision = resolveRoleChange({
      actingUserId: session.user.id,
      targetUserId: memberId,
      targetCurrentRole: target.role === "admin" ? "admin" : "user",
      nextRole,
      currentAdminCount: admins.length
    });

    if (!decision.ok) {
      return { status: "failed", message: decision.message };
    }

    await db.update(users).set({ role: nextRole }).where(eq(users.id, memberId));
    revalidatePath("/team");

    return { status: "updated", email: target.email, role: nextRole };
  } catch {
    return { status: "failed", message: "The user database is not reachable right now. Try again, or check the System page." };
  }
}
