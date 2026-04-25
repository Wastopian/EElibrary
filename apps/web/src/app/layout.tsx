/**
 * File header: Defines the global web app shell for EE Library.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { DM_Mono, DM_Sans, Syne } from "next/font/google";
import { AppNavigation } from "../components/AppNavigation";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["400", "600", "700", "800"] });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", weight: ["400", "500", "600", "700"] });
const dmMono = DM_Mono({ subsets: ["latin"], variable: "--font-dm-mono", weight: ["400", "500"] });

/** Metadata describes the engineering workspace in browser chrome. */
export const metadata: Metadata = {
  description: "Normalized component search, connector build sets, and file-honest CAD export readiness.",
  title: "EE Library"
};

/**
 * Renders the desktop-first application shell around every route.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`} lang="en">
      <body>
        <a className="skip-link" href="#page-content">
          Skip to main content
        </a>
        <div className="app-shell">
          <aside aria-label="Primary workspace shell" className="app-sidebar">
            <Link className="app-sidebar__brand-link" href="/">
              <div className="app-sidebar__brand">
                <p className="app-kicker">EE Library</p>
                <p className="app-sidebar__title">Engineering readiness workspace</p>
                <p className="app-sidebar__subtitle">Search, inspect, trust, and export with explicit blocker visibility, connector intelligence, and asset truth.</p>
              </div>
            </Link>
            <AppNavigation />
            <section aria-label="Trust boundary guidance" className="app-sidebar__note">
              <span>Trust boundary</span>
              <strong>Generated, approved, and export-ready stay separate.</strong>
              <p>The shell keeps the core workflow visible without collapsing review truth, connector uncertainty, or verified file-backed export evidence into one vague status.</p>
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
