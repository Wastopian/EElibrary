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
                <p className="app-sidebar__subtitle">Projects - parts - evidence - reuse.</p>
              </div>
            </Link>
            <AppNavigation />
            <section aria-label="Confidence guidance" className="app-sidebar__note">
              <span>Before export</span>
              <strong>Only use verified files for release.</strong>
              <p>Need details? Open any part and select "How to read this" in the trust section.</p>
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
