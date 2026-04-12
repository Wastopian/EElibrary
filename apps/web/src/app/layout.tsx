/**
 * File header: Defines the global web app shell for EE Library.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/** Metadata describes the engineering workspace in browser chrome. */
export const metadata: Metadata = {
  description: "Engineering-first component search, inspection, and export workspace.",
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
              <h1>Component workspace</h1>
            </div>
            <nav aria-label="Primary navigation" className="app-nav">
              <a href="/">Search</a>
              <span>Compare</span>
              <span>Tools</span>
              <span>Admin</span>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
