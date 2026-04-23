"use client";

/**
 * File header: Renders sticky section navigation for the long detail workspace.
 */

import React from "react";

/** DetailSectionTab defines one visible detail section destination. */
export type DetailSectionTab = {
  badge?: string | undefined;
  href: string;
  label: string;
};

/**
 * Renders the detail workspace section tabs and highlights the active hash section.
 */
export function DetailSectionNav({ tabs }: { tabs: DetailSectionTab[] }) {
  const [activeHash, setActiveHash] = React.useState<string>(tabs[0]?.href ?? "#overview-heading");

  React.useEffect(() => {
    const readHash = () => setActiveHash(window.location.hash || tabs[0]?.href || "#overview-heading");

    readHash();
    window.addEventListener("hashchange", readHash);

    return () => {
      window.removeEventListener("hashchange", readHash);
    };
  }, [tabs]);

  return (
    <nav aria-label="Readiness record sections" className="detail-tabbar">
      {tabs.map((tab) => (
        <a aria-current={activeHash === tab.href ? "true" : undefined} href={tab.href} key={tab.href}>
          <span>{tab.label}</span>
          {tab.badge ? <span className="detail-tabbar__count">{tab.badge}</span> : null}
        </a>
      ))}
    </nav>
  );
}
