/**
 * File header: Renders the shared application shell without importing global CSS.
 *
 * Two modes:
 *  - **authenticated** (default): full workstation shell — brand, sidebar search,
 *    workspace navigation, and the release reminder. This is what every signed-in
 *    operator sees on every route.
 *  - **unauthenticated**: a minimal shell with only the brand + skip-link wrapped
 *    around the children. Used for `/sign-in` and `/sign-up` so a first visit does
 *    not face a wall of workspace links it cannot click. The auth-page content is
 *    free to use the full main width.
 */

import React, { Suspense } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AppNavigation, AppNavigationLinks } from "../components/AppNavigation";

/** RootLayoutShellProps carries page content and optional font class names from the Next layout. */
export interface RootLayoutShellProps {
  /** Route content rendered inside the shell's main content region. */
  children: ReactNode;
  /** Font CSS variable classes supplied by next/font in the real layout. */
  fontClassName?: string;
  /**
   * Whether the shell should render the full workstation sidebar.
   *
   * Defaults to `true` so existing tests and any caller that does not know about
   * the auth state get the full shell. Pass `false` from a route that knows the
   * viewer has no session (sign-in, sign-up) to render the minimal variant.
   */
  isAuthenticated?: boolean;
  /**
   * Optional account block rendered at the bottom of the authenticated sidebar (signed-in identity
   * plus sign-out). Supplied by the real layout, which knows the session; omitted in tests.
   */
  accountSlot?: ReactNode;
}

/**
 * Renders the desktop-first application shell around every route.
 */
export function RootLayoutShell({ children, fontClassName = "", isAuthenticated = true, accountSlot }: RootLayoutShellProps) {
  return (
    <html className={fontClassName} lang="en">
      <body>
        <a className="skip-link" href="#page-content">
          Skip to main content
        </a>
        {isAuthenticated ? renderAuthenticatedShell(children, accountSlot) : renderUnauthenticatedShell(children)}
      </body>
    </html>
  );
}

/**
 * Renders the full workstation shell — brand, search, workspace nav, release reminder.
 */
function renderAuthenticatedShell(children: ReactNode, accountSlot?: ReactNode) {
  return (
    <div className="app-shell">
      <aside aria-label="Primary workspace shell" className="app-sidebar">
        <Link className="app-sidebar__brand-link" href="/">
          <div className="app-sidebar__brand">
            <p className="app-kicker">EE Library</p>
            <p className="app-sidebar__title">Engineering memory</p>
            <p className="app-sidebar__subtitle">Find parts. Open projects. Ship verified files.</p>
          </div>
        </Link>
        <form action="/catalog" className="app-sidebar__search" method="get" role="search">
          <label className="app-sidebar__search-label" htmlFor="sidebar-search">
            Search a part number
          </label>
          <input
            aria-label="Search the catalog by part number"
            autoComplete="off"
            className="app-sidebar__search-input"
            id="sidebar-search"
            name="q"
            placeholder="MPN or keyword"
            type="search"
          />
        </form>
        {/* AppNavigation reads the URL via useSearchParams, which `next build` only accepts
            behind a Suspense boundary; the fallback renders the same links without an
            active-state highlight for the instant before the URL is known. */}
        <Suspense fallback={<AppNavigationLinks currentLocation="" />}>
          <AppNavigation />
        </Suspense>
        <section aria-label="Release reminder" className="app-sidebar__note">
          <span>Before release</span>
          <strong>Only use verified files.</strong>
          <p>Open any part and expand &quot;How verification works&quot; for the full explanation.</p>
        </section>
        {accountSlot}
      </aside>
      <div className="app-main">
        <div className="app-main__content" id="page-content">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the minimal shell shown to unauthenticated visitors on /sign-in and /sign-up.
 *
 * No workspace nav, no search, no release reminder — only the brand identity and
 * the route's own content. A first visit shouldn't look like a wall of links the
 * visitor cannot click.
 */
function renderUnauthenticatedShell(children: ReactNode) {
  return (
    <div className="app-shell app-shell--auth">
      <header aria-label="EE Library identity" className="app-shell__auth-header">
        <Link className="app-shell__auth-brand" href="/sign-in">
          <p className="app-kicker">EE Library</p>
          <p className="app-shell__auth-title">Engineering memory</p>
        </Link>
      </header>
      <div className="app-main app-main--auth">
        <div className="app-main__content" id="page-content">
          {children}
        </div>
      </div>
    </div>
  );
}
