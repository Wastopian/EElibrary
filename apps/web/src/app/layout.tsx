/**
 * File header: Defines the global web app shell for EE Library.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <div>
              <p className="app-kicker">EE Library</p>
              <h1>Engineering catalog</h1>
            </div>
            <nav aria-label="Primary navigation" className="app-nav">
              <a href="/">Catalog</a>
              <span>Compare</span>
              <span>Tools</span>
              <a href="/admin">Admin</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
