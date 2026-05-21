/**
 * File header: Shows the signed-in account and a sign-out control in the workspace sidebar.
 */

import React from "react";
import { auth, signOut } from "../auth";

/**
 * Renders the current session summary and sign-out action at the bottom of the sidebar.
 */
export async function AppSidebarAccount(): Promise<React.ReactElement | null> {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  const email = session.user.email ?? "Signed in";
  const roleLabel = session.user.role === "admin" ? "Admin" : "User";

  return (
    <section aria-label="Signed-in account" className="app-sidebar__account">
      <span>Signed in as</span>
      <strong className="app-sidebar__account-email">{email}</strong>
      <span className="app-sidebar__account-role">{roleLabel}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/sign-in?notice=signed_out" });
        }}
      >
        <button className="app-sidebar__sign-out" type="submit">
          Sign out
        </button>
      </form>
    </section>
  );
}
