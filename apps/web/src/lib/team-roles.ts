/**
 * File header: Pure team-role assignment rules (RBAC v1).
 *
 * The team is small and trusted, so RBAC v1 adds the ability to scope a member down to read-only
 * without restricting anyone by default: `admin` keeps full power (the default for every account),
 * and `user` is a read-only member — the API already gates every mutation behind an admin check, so
 * a `user` can browse, search, and open records but cannot approve, import, or edit. These helpers
 * hold the decision logic worth testing on its own; the server action stays a thin DB wrapper.
 */

/** TeamRole is the assignable role set for v1. Narrower roles (approver, contributor) come later. */
export type TeamRole = "admin" | "user";

/** ROLE_LABELS render the roles in plain language for the audience (not "user"/"admin" jargon). */
export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Admin (full access)",
  user: "Read-only"
};

/** RoleChangeDecision is the pure verdict the server action enforces before writing. */
export type RoleChangeDecision = { ok: true } | { ok: false; message: string };

/** RoleChangeInput is everything the decision needs, resolved from the session and a scoped DB read. */
export interface RoleChangeInput {
  /** The signed-in admin performing the change. */
  actingUserId: string;
  /** The member whose role would change. */
  targetUserId: string;
  /** The target's current role. */
  targetCurrentRole: TeamRole;
  /** The role the admin wants to set. */
  nextRole: TeamRole;
  /** How many admins the acting org has right now (including the target if they are one). */
  currentAdminCount: number;
}

/**
 * Decides whether one role change is allowed. Guards, in order: the acting user cannot change their
 * own role (an admin must ask a teammate, which prevents accidental self-lockout and keeps the
 * "who demoted me" trail honest); a no-op change is rejected plainly; and the org's last admin can
 * never be demoted, so a team can never lock itself out of every admin-only action.
 */
export function resolveRoleChange(input: RoleChangeInput): RoleChangeDecision {
  if (input.actingUserId === input.targetUserId) {
    return { ok: false, message: "You cannot change your own role. Ask another admin on your team." };
  }

  if (input.targetCurrentRole === input.nextRole) {
    return { ok: false, message: `That member is already ${ROLE_LABELS[input.nextRole]}.` };
  }

  if (input.targetCurrentRole === "admin" && input.nextRole === "user" && input.currentAdminCount <= 1) {
    return { ok: false, message: "Your team needs at least one admin. Make someone else an admin first." };
  }

  return { ok: true };
}

/** Narrows an untrusted role string to the assignable set, or null when it is not a valid role. */
export function parseTeamRole(value: unknown): TeamRole | null {
  return value === "admin" || value === "user" ? value : null;
}

/**
 * True when the role may mint invites, reset passwords, or change roles. Read-only members (`user`)
 * must not — joins still create full-access admins, so an invite from a demoted member is privilege
 * escalation.
 */
export function canAdministerTeam(role: string | null | undefined): boolean {
  return role === "admin";
}
