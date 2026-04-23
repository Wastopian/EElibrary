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
            <header className="app-main-header">
              <div>
                <p className="app-kicker">Engineering workstation</p>
                <p className="app-main-header__title">Search, inspect, trust, and export with explicit evidence.</p>
                <p className="app-main-header__subtitle">The current product surface is centered on quick readiness checks, detailed part records, connector buildability, and admin issue operations backed by real catalog truth.</p>
              </div>
              <div className="app-main-header__panel">
                <span>Current focus</span>
                <strong>Quick readiness check, search triage, detail records, and admin review operations</strong>
                <p>Non-functional compare and tool areas stay out of the shell until they are real workflows.</p>
              </div>
            </header>
            <div className="app-main__content" id="page-content">
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
