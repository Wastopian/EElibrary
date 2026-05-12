/**
 * File header: Renders the shared application shell without importing global CSS.
 */

import React from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AppNavigation } from "../components/AppNavigation";

/** RootLayoutShellProps carries page content and optional font class names from the Next layout. */
export interface RootLayoutShellProps {
  /** Route content rendered inside the shell's main content region. */
  children: ReactNode;
  /** Font CSS variable classes supplied by next/font in the real layout. */
  fontClassName?: string;
}

/**
 * Renders the desktop-first application shell around every route.
 */
export function RootLayoutShell({ children, fontClassName = "" }: RootLayoutShellProps) {
  return (
    <html className={fontClassName} lang="en">
      <body>
        <a className="skip-link" href="#page-content">
          Skip to main content
        </a>
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
            <AppNavigation />
            <section aria-label="Release reminder" className="app-sidebar__note">
              <span>Before release</span>
              <strong>Only use verified files.</strong>
              <p>Open any part and expand "How verification works" for the full explanation.</p>
            </section>
          </aside>
          <div className="app-main">
            <div className="app-main__content" id="page-content">
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
