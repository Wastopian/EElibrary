/**
 * File header: Load the persisted team role for an authenticated user.
 *
 * RBAC v1 demotion writes `users.role`, but the Auth.js JWT cookie keeps the pre-demotion claim until
 * the next sign-in. Invite minting, password reset, role changes, and API token issuance must read
 * the live row so a demoted member cannot keep acting as admin from a stale session cookie.
 */

import { createDbPool, users, type DbPool } from "@ee-library/db";
import { eq } from "drizzle-orm";
import { parseTeamRole, type TeamRole } from "@/lib/team-roles";

/** DEFAULT_DATABASE_URL matches the other web auth helpers when DATABASE_URL is unset locally. */
const DEFAULT_DATABASE_URL = "postgres://ee_library:ee_library@localhost:5432/ee_library";

/** LiveSessionRole is the org-scoped role currently stored for one user id. */
export interface LiveSessionRole {
  role: TeamRole;
  orgId: string;
}

/**
 * Reads the current role and org for `userId` from the users table. Returns null when the account
 * no longer exists so callers can fail closed instead of trusting a stale JWT claim.
 */
export async function readLiveSessionRole(
  userId: string,
  db: DbPool = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL)
): Promise<LiveSessionRole | null> {
  const [row] = await db
    .select({ orgId: users.orgId, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  const role = parseTeamRole(row.role);

  if (!role) {
    return null;
  }

  return {
    orgId: row.orgId ?? "org-default",
    role
  };
}
