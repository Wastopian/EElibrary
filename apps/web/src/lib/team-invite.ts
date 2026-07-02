/**
 * File header: Pure per-org teammate-invite helpers (Increment 4).
 *
 * Each organization has one reusable invite code (`organizations.invite_code`). A teammate enters it at
 * sign-up to join that org as a full-access admin. These helpers hold the pieces worth testing on their
 * own — code generation / normalization, the joining-user record shape, and the Team-page view model —
 * so the server actions stay thin DB wrappers.
 */

import { randomInt, randomUUID } from "node:crypto";

/**
 * Crockford base32 without the ambiguous letters (I, L, O, U), so a code read aloud or copied by hand
 * is unlikely to be mistyped — the app's audience is not always at a keyboard when sharing it.
 */
const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** INVITE_CODE_GROUPS × INVITE_CODE_GROUP_LENGTH random chars follow the readable `TEAM-` prefix. */
const INVITE_CODE_GROUPS = 2;
const INVITE_CODE_GROUP_LENGTH = 4;

/** InviteJoinUserRecord is the user row a teammate join inserts (no new org). */
export interface InviteJoinUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin";
  orgId: string;
}

/** TeamInviteView is the resolved Team-page state derived from the acting org row. */
export interface TeamInviteView {
  teamName: string;
  inviteCode: string | null;
  needsGeneration: boolean;
}

/**
 * Generates a readable, hard-to-guess reusable invite code such as `TEAM-7F3K-92AB`. The unique index
 * on `organizations.invite_code` guards the (astronomically unlikely) collision.
 */
export function generateInviteCode(): string {
  const groups: string[] = [];

  for (let group = 0; group < INVITE_CODE_GROUPS; group += 1) {
    let chars = "";

    for (let position = 0; position < INVITE_CODE_GROUP_LENGTH; position += 1) {
      chars += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
    }

    groups.push(chars);
  }

  return `TEAM-${groups.join("-")}`;
}

/**
 * Normalizes a submitted invite code for lookup so casing and stray whitespace never cause a false miss.
 */
export function normalizeInviteCode(rawInviteCode: string): string {
  return rawInviteCode.trim().toUpperCase();
}

/**
 * Builds the user row for a teammate joining an existing org. They get the same full-access `admin` role
 * as the team creator (the team is small and trusted; restrict no one by default) and the org id is
 * taken from the resolved invite — never from user input.
 */
export function buildJoiningUserRecord(input: { email: string; passwordHash: string; orgId: string }): InviteJoinUserRecord {
  return {
    email: input.email,
    id: randomUUID(),
    orgId: input.orgId,
    passwordHash: input.passwordHash,
    role: "admin"
  };
}

/**
 * Resolves the Team-page view from the acting organization row. A null code means the org predates
 * org-on-signup (e.g. `org-default`) and has to generate one before it can invite.
 */
export function resolveTeamInviteView(organization: { name: string; inviteCode: string | null }): TeamInviteView {
  return {
    inviteCode: organization.inviteCode,
    needsGeneration: organization.inviteCode === null,
    teamName: organization.name
  };
}
