/**
 * File header: Account page — who you are signed in as, your team, and password change.
 *
 * The audience manages one workstation account; this page is the single place to see that identity
 * and change the password without asking an admin to run reset scripts.
 */

import { auth } from "@/auth";
import { resolveAccountNotice } from "@/lib/account";
import { createDbPool, organizations } from "@ee-library/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import React from "react";
import { changePasswordAction, signOutAction } from "./actions";

/** AccountSearchParams carries feedback flags pushed back from the password-change action. */
type AccountSearchParams = {
  error?: string | string[];
  notice?: string | string[];
};

/** DEFAULT_DATABASE_URL keeps the page usable in local dev when the env var is omitted. */
const DEFAULT_DATABASE_URL = "postgres://ee_library:ee_library@localhost:5432/ee_library";

/**
 * Renders the signed-in identity, team membership, and the change-password form.
 */
export default async function AccountPage({ searchParams }: { searchParams?: Promise<AccountSearchParams> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/sign-in?callbackUrl=%2Faccount");
  }

  const resolved = (await searchParams) ?? {};
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const notice = resolveAccountNotice(first(resolved.error), first(resolved.notice));
  const teamName = await readTeamName(session.user.orgId);

  return (
    <main className="workspace-page account-page">
      <section className="detail-section" aria-labelledby="account-heading">
        <p className="app-kicker">Your account</p>
        <h1 id="account-heading">Account</h1>
        <p>Who you are signed in as, which team you belong to, and your password.</p>
      </section>

      <section className="detail-section" aria-labelledby="account-identity-heading">
        <h2 id="account-identity-heading">Signed in as</h2>
        <dl className="dimension-grid">
          <div>
            <dt>Email</dt>
            <dd className="ui-mono">{session.user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{session.user.role === "admin" ? "Admin (full access)" : "User"}</dd>
          </div>
          <div>
            <dt>Team</dt>
            <dd>
              {teamName ?? session.user.orgId} — <Link className="button-link button-link--quiet" href="/team">manage invites</Link>
            </dd>
          </div>
        </dl>
        <form action={signOutAction}>
          <button className="button-link" type="submit">Sign out</button>
        </form>
      </section>

      <section className="detail-section" aria-labelledby="account-password-heading">
        <h2 id="account-password-heading">Change password</h2>
        {notice ? (
          <div className={`auth-feedback auth-feedback--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            <strong>{notice.title}</strong>
            <p>{notice.body}</p>
          </div>
        ) : null}
        <form action={changePasswordAction} className="auth-form">
          <label htmlFor="current-password">Current password</label>
          <input autoComplete="current-password" id="current-password" name="currentPassword" required type="password" />
          <label htmlFor="new-password">New password</label>
          <input autoComplete="new-password" id="new-password" minLength={8} name="newPassword" required type="password" />
          <label htmlFor="confirm-new-password">Confirm new password</label>
          <input autoComplete="new-password" id="confirm-new-password" minLength={8} name="confirmPassword" required type="password" />
          <button className="auth-form__primary-action" type="submit">Change password</button>
        </form>
      </section>
    </main>
  );
}

/**
 * Reads the team's display name; null when the organization row is missing (the raw id then shows).
 */
async function readTeamName(orgId: string): Promise<string | null> {
  try {
    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    const [row] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return row?.name ?? null;
  } catch {
    return null;
  }
}
