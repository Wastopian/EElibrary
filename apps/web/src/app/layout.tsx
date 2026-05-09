/**
 * File header: Defines the global web app shell for EE Library.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Mono, DM_Sans, Syne } from "next/font/google";
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
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return <RootLayoutShell fontClassName={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}>{children}</RootLayoutShell>;
}
