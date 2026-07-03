/**
 * File header: Sidebar account block — who is signed in, a link to manage the account, and sign out.
 *
 * Rendered by the root layout into the shell's account slot on every authenticated page. Before this
 * existed there was no sign-out control anywhere in the product and no indication of the signed-in
 * identity. The sign-out button is a plain server-action form, so it works before hydration too.
 */

import Link from "next/link";
import React from "react";
import { signOutAction } from "./account/actions";

/** AccountRailProps carries the signed-in identity resolved by the layout's session read. */
interface AccountRailProps {
  email: string;
}

/**
 * Renders the signed-in identity with account and sign-out affordances.
 */
export function AccountRail({ email }: AccountRailProps): React.ReactElement {
  return (
    <section aria-label="Your account" className="app-sidebar__account">
      <span className="app-sidebar__account-label">Signed in as</span>
      <Link className="app-sidebar__account-email ui-mono" href="/account" title="Open your account page">
        {email}
      </Link>
      <div className="app-sidebar__account-actions">
        <Link className="button-link button-link--quiet" href="/account">
          Account
        </Link>
        <form action={signOutAction}>
          <button className="button-link button-link--quiet" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </section>
  );
}
