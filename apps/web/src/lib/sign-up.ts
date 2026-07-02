/**
 * File header: Pure sign-up domain helpers for org-on-signup.
 *
 * Multi-tenancy activates when a new sign-up creates its own organization and the user becomes that
 * org's admin (Increment 3). These helpers hold the two pieces worth testing on their own — team-name
 * normalization and the org + admin-user record shape — so the server action stays a thin transaction
 * around them.
 */

import { randomUUID } from "node:crypto";
import { generateInviteCode } from "./team-invite";

/** MAX_TEAM_NAME_LENGTH caps the org name so a stray paste can't fill the column. */
export const MAX_TEAM_NAME_LENGTH = 120;

/** NewTeamRecords is the org + admin-user pair a sign-up inserts atomically. */
export interface NewTeamRecords {
  organization: {
    id: string;
    name: string;
    slug: string;
    inviteCode: string;
  };
  user: {
    id: string;
    email: string;
    passwordHash: string;
    role: "admin";
    orgId: string;
  };
}

/**
 * Trims and length-checks a submitted team name. Returns null when it is empty or too long so the
 * caller can reject the sign-up with a friendly notice.
 */
export function normalizeTeamName(rawTeamName: string): string | null {
  const trimmed = rawTeamName.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_TEAM_NAME_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Builds the organization and its first user for a new team sign-up. The user is the org's `admin`
 * (they created the team), and the org id is generated fresh so two teams never share one. The slug
 * reuses the unique org id so it satisfies the unique-slug index without a naming collision — a
 * human-friendly slug can follow with org-management UI. The org also gets a reusable invite code so a
 * teammate can join it from day one (Increment 4).
 */
export function buildNewTeamRecords(input: { email: string; passwordHash: string; teamName: string }): NewTeamRecords {
  const orgId = `org-${randomUUID().slice(0, 8)}`;

  return {
    organization: {
      id: orgId,
      inviteCode: generateInviteCode(),
      name: input.teamName,
      slug: orgId
    },
    user: {
      email: input.email,
      id: randomUUID(),
      orgId,
      passwordHash: input.passwordHash,
      role: "admin"
    }
  };
}
