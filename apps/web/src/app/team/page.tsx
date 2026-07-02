/**
 * File header: Team page — view, copy, and regenerate the organization's reusable teammate invite code.
 *
 * Per-org teammate invites (Increment 4): a member shares this code and a teammate enters it at sign-up
 * (`/sign-up?join=1`) to join the team as a full-access admin. The code is a shared secret, so
 * regenerating it invalidates the previous one.
 */

import { auth } from "@/auth";
import { generateInviteCode, resolveTeamInviteView } from "@/lib/team-invite";
import { createDbPool, organizations } from "@ee-library/db";
import { EmptyState, SectionHeading, SectionPanel } from "@ee-library/ui";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import React from "react";
import { CopyInviteCode } from "./CopyInviteCode";

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
    </main>
  );
}
