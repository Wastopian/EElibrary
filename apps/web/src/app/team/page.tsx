/**
 * File header: Team page — view, copy, and regenerate the organization's reusable teammate invite code.
 *
 * Per-org teammate invites (Increment 4): a member shares this code and a teammate enters it at sign-up
 * (`/sign-up?join=1`) to join the team as a full-access admin. The code is a shared secret, so
 * regenerating it invalidates the previous one.
 */

import { auth } from "@/auth";
import { computeInviteTokenExpiry, DEFAULT_INVITE_TOKEN_TTL_DAYS, generateInviteCode, resolveTeamInviteView } from "@/lib/team-invite";
import { createInviteToken, listActiveInviteTokens, revokeInviteToken } from "@/lib/invite-token-store";
import { createDbPool, organizations, users } from "@ee-library/db";
import { EmptyState, SectionHeading, SectionPanel } from "@ee-library/ui";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import React from "react";
import { CopyInviteCode } from "./CopyInviteCode";
import { MembersPanel } from "./MembersPanel";

/** DEFAULT_DATABASE_URL keeps the page usable in local dev when the env var is omitted. */
const DEFAULT_DATABASE_URL = "postgres://ee_library:ee_library@localhost:5432/ee_library";

/**
 * Sets a fresh invite code on the acting user's organization. Handles both first-time generation and
 * regeneration. The org id is read from the session at action time — never from form input — so a member
 * can only ever rotate their own team's code.
 */
async function setTeamInviteCode(): Promise<void> {
  "use server";

  const session = await auth();
  const orgId = session?.user?.orgId;

  if (!orgId) {
    redirect("/sign-in");
  }

  const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
  await db.update(organizations).set({ inviteCode: generateInviteCode() }).where(eq(organizations.id, orgId));

  revalidatePath("/team");
}

/**
 * Issues one single-use, expiring invite token for the acting user's org. Org id and issuer come from
 * the session at action time, never from input, so a member can only ever invite into their own team.
 */
async function issueSingleUseInvite(): Promise<void> {
  "use server";

  const session = await auth();
  const orgId = session?.user?.orgId;

  if (!orgId) {
    redirect("/sign-in");
  }

  const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
  await createInviteToken(db, {
    orgId,
    createdBy: session?.user?.id ?? null,
    expiresAt: computeInviteTokenExpiry(new Date()),
  });

  revalidatePath("/team");
}

/**
 * Revokes one still-unused single-use token, strictly scoped to the acting user's org.
 */
async function revokeSingleUseInvite(formData: FormData): Promise<void> {
  "use server";

  const session = await auth();
  const orgId = session?.user?.orgId;

  if (!orgId) {
    redirect("/sign-in");
  }

  const tokenId = typeof formData.get("tokenId") === "string" ? (formData.get("tokenId") as string) : "";

  if (tokenId) {
    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    await revokeInviteToken(db, { tokenId, orgId });
  }

  revalidatePath("/team");
}

/**
 * Renders the team invite management surface for the signed-in member's organization.
 */
export default async function TeamPage() {
  const session = await auth();
  const orgId = session?.user?.orgId;

  if (!orgId) {
    redirect("/sign-in");
  }

  const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
  const [organization] = await db
    .select({ inviteCode: organizations.inviteCode, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!organization) {
    return (
      <main className="workspace-page team-page">
        <SectionHeading id="team" title="Team" />
        <EmptyState
          body="Your organization record could not be loaded. Run the local setup or migration flow, then try again."
          title="Team is unavailable"
        />
      </main>
    );
  }

  const view = resolveTeamInviteView(organization);
  const activeTokens = await listActiveInviteTokens(db, orgId);
  const members = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(users.email);

  return (
    <main className="workspace-page team-page">
      <SectionHeading id="team" subtitle={view.teamName} title="Team" />
      <SectionPanel
        description="Share one code with a teammate. They enter it at sign-up to join your team and see its shared parts, projects, and files."
        title="Invite teammates"
      >
        {view.inviteCode ? (
          <div className="team-invite">
            <p>
              Teammates join <strong>{view.teamName}</strong> by choosing <em>Join a team</em> at sign-up and entering:
            </p>
            <p className="team-invite__code">
              <code>{view.inviteCode}</code>
            </p>
            <div className="team-invite__actions">
              <CopyInviteCode inviteCode={view.inviteCode} />
              <form action={setTeamInviteCode}>
                <button className="button-link button-link--quiet" type="submit">
                  Regenerate code
                </button>
              </form>
            </div>
            <p className="team-invite__hint">
              New teammates join as full-access members. Regenerating makes the current code stop working, so only
              people you share the new code with can join.
            </p>
          </div>
        ) : (
          <div className="team-invite">
            <p>Your team does not have an invite code yet. Generate one to invite a teammate.</p>
            <form action={setTeamInviteCode}>
              <button className="button-link" type="submit">
                Generate invite code
              </button>
            </form>
          </div>
        )}
      </SectionPanel>

      <SectionPanel
        description={`Prefer these for one-off invites: each works for a single new account and expires in ${DEFAULT_INVITE_TOKEN_TTL_DAYS} days, so a link that leaks or is over-shared cannot admit extra people. The shared code above still works for bulk onboarding.`}
        title="Single-use invites"
      >
        <div className="team-invite">
          <form action={issueSingleUseInvite}>
            <button className="button-link" type="submit">
              Create single-use invite
            </button>
          </form>
          {activeTokens.length > 0 ? (
            <ul className="team-invite__token-list">
              {activeTokens.map((activeToken) => (
                <li className="team-invite__token" key={activeToken.id}>
                  <code>{activeToken.token}</code>
                  <span className="team-invite__hint">
                    Expires {activeToken.expiresAt.toLocaleDateString()}
                  </span>
                  <form action={revokeSingleUseInvite}>
                    <input name="tokenId" type="hidden" value={activeToken.id} />
                    <button className="button-link button-link--quiet" type="submit">
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="team-invite__hint">No active single-use invites. Create one to invite a teammate with a link that works exactly once.</p>
          )}
        </div>
      </SectionPanel>

      <SectionPanel
        description="Who belongs to this team. If a teammate forgets their password, reset it here and hand them the temporary one directly."
        title="Members"
      >
        <MembersPanel actingUserId={session?.user?.id ?? ""} members={members} />
      </SectionPanel>
    </main>
  );
}
