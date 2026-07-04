/**
 * File header: Defines the global web app shell for EE Library.
 *
 * The layout reads the current session so unauthenticated routes (`/sign-in`,
 * `/sign-up`) render a minimal shell with no workspace navigation. Authenticated
 * routes get the full workstation shell.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Mono, DM_Sans, Syne } from "next/font/google";
import { auth } from "@/auth";
import { AccountRail } from "./AccountRail";
import { RootLayoutShell } from "./RootLayoutShell";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["400", "600", "700", "800"] });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", weight: ["400", "500", "600", "700"] });
const dmMono = DM_Mono({ subsets: ["latin"], variable: "--font-dm-mono", weight: ["400", "500"] });

/** Metadata describes the engineering workspace in browser chrome. */
export const metadata: Metadata = {
  description: "Private engineering memory for parts, projects, evidence, connector sets, and export readiness.",
  title: "EE Library"
};

/**
 * Renders the desktop-first application shell around every route with global CSS loaded.
 *
 * The session check is best-effort: any failure (DB unreachable, malformed JWT)
 * degrades to the authenticated shell so signed-in operators are never accidentally
 * stripped of their workspace nav when auth probing fails.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const shellSession = await detectSession();

  return (
    <RootLayoutShell
      accountSlot={shellSession.email ? <AccountRail email={shellSession.email} /> : undefined}
      fontClassName={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}
      isAuthenticated={shellSession.isAuthenticated}
    >
      {children}
    </RootLayoutShell>
  );
}

/**
 * Reads the session without crashing the layout if auth dependencies are degraded.
 *
 * Any thrown error is treated as authenticated (with no identity to show) so the full shell
 * renders — losing the workspace nav silently would be worse than briefly showing it to an
 * unauthenticated user (middleware still gates the actual routes).
 */
async function detectSession(): Promise<{ isAuthenticated: boolean; email: string | null }> {
  try {
    const session = await auth();
    return { email: session?.user?.email ?? null, isAuthenticated: Boolean(session) };
  } catch {
    return { email: null, isAuthenticated: true };
  }
}
