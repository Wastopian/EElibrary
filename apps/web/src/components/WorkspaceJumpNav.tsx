/**
 * File header: Renders compact jump navigation for long engineering workspace pages.
 */

import Link from "next/link";
import React from "react";

/** WorkspaceJumpItem defines one local or route-level destination in the jump nav. */
export type WorkspaceJumpItem = {
  href: string;
  label: string;
};

interface WorkspaceJumpNavProps {
  ariaLabel: string;
  items: WorkspaceJumpItem[];
}

/**
 * Renders a compact list of navigation links so operators can move between major sections quickly.
 */
export function WorkspaceJumpNav({ ariaLabel, items }: WorkspaceJumpNavProps) {
  return (
    <nav aria-label={ariaLabel} className="workspace-jump-nav">
      <span className="workspace-jump-nav__label">Navigate</span>
      <div className="workspace-jump-nav__links">
        {items.map((item) => (
          <Link href={item.href} key={item.href}>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
