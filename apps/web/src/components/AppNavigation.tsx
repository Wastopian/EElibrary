"use client";

/**
 * File header: Renders the shared workstation navigation for EE Library.
 */

import { usePathname, useSearchParams } from "next/navigation";
import React from "react";

/** NavigationMatch explains how one navigation link determines its active state. */
type NavigationMatch =
  | {
      path: string;
      type: "path";
    }
  | {
      name: string;
      type: "query";
      value: string;
    };

/** NavigationItem defines one concrete workspace route or saved view. */
type NavigationItem = {
  description: string;
  href: string;
  label: string;
  match: NavigationMatch;
};

/** NavigationGroup keeps the shell navigation grouped by engineer task. */
type NavigationGroup = {
  items: NavigationItem[];
  label: string;
};

/**
 * Renders the primary workstation navigation and keeps active state visible for operators.
 */
export function AppNavigation() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const currentLocation = query ? `${pathname}?${query}` : pathname;

  return <AppNavigationLinks currentLocation={currentLocation} />;
}

/**
 * Renders the actual workstation links from a supplied location for runtime and test usage.
 */
export function AppNavigationLinks({ currentLocation }: { currentLocation: string }) {
  const groups: NavigationGroup[] = [
    {
      items: [
        {
          description: "Find a part, then open its full record.",
          href: "/catalog",
          label: "Catalog",
          match: { path: "/catalog", type: "path" }
        },
        {
          description: "Compare up to four parts side-by-side.",
          href: "/compare",
          label: "Compare",
          match: { path: "/compare", type: "path" }
        },
        {
          description: "Open your project list and BOM history.",
          href: "/projects",
          label: "Projects",
          match: { path: "/projects", type: "path" }
        },
        {
          description: "Remember PCB shops, sheet metal, and who you trust.",
          href: "/vendors",
          label: "Vendors",
          match: { path: "/vendors", type: "path" }
        },
        {
          description: "See where a part or file is used.",
          href: "/where-used",
          label: "Where-used",
          match: { path: "/where-used", type: "path" }
        },
        {
          description: "Add and review supporting notes and files.",
          href: "/evidence",
          label: "Evidence",
          match: { path: "/evidence", type: "path" }
        },
        {
          description: "Save reusable circuit patterns.",
          href: "/circuit-blocks",
          label: "Circuit blocks",
          match: { path: "/circuit-blocks", type: "path" }
        },
        {
          description: "Browse connector families and matching mates.",
          href: "/connector-sets",
          label: "Connector sets",
          match: { path: "/connector-sets", type: "path" }
        },
        {
          description: "Quick EE math — voltage divider, RC time constant.",
          href: "/tools",
          label: "Tools",
          match: { path: "/tools", type: "path" }
        },
        {
          description: "Handle review queues and blocked items.",
          href: "/admin",
          label: "Admin",
          match: { path: "/admin", type: "path" }
        },
        {
          description: "Check service status and health.",
          href: "/system",
          label: "System",
          match: { path: "/system", type: "path" }
        }
      ],
      label: "Workspaces"
    },
    {
      items: [
        {
          description: "Open the catalog filtered to connectors.",
          href: "/catalog?category=Connector",
          label: "Connectors",
          match: { name: "category", type: "query", value: "Connector" }
        },
        {
          description: "Open the catalog filtered to parts missing CAD.",
          href: "/catalog?cad=unavailable",
          label: "Missing CAD",
          match: { name: "cad", type: "query", value: "unavailable" }
        },
        {
          description: "Open the catalog filtered to parts waiting for review.",
          href: "/catalog?approvalStatus=pending_review",
          label: "Pending review",
          match: { name: "approvalStatus", type: "query", value: "pending_review" }
        }
      ],
      label: "Catalog filters"
    }
  ];

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      {groups.map((group) => {
        const isFilterGroup = group.label === "Catalog filters";

        return (
          <section className={isFilterGroup ? "app-nav__group app-nav__group--filters" : "app-nav__group"} key={group.label}>
            <p className="app-nav__group-label">{group.label}</p>
            <div className="app-nav__group-links">
              {group.items.map((item) => {
                const isActive = isNavigationItemActive(item, currentLocation);
                const className = `${isActive ? "app-nav__link app-nav__link--active" : "app-nav__link"}${isFilterGroup ? " app-nav__link--filter" : ""}`;

                return (
                  <a aria-current={isActive ? "page" : undefined} aria-label={`${item.label}: ${item.description}`} className={className} href={item.href} key={item.href}>
                    <span className="app-nav__link-label">{item.label}</span>
                    <span className="app-nav__link-description">{item.description}</span>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

/**
 * Determines whether one navigation item should render as active for the supplied location.
 */
function isNavigationItemActive(item: NavigationItem, currentLocation: string): boolean {
  const { pathname, searchParams } = parseCurrentLocation(currentLocation);

  if (item.match.type === "path") {
    if (item.match.path === "/catalog") {
      return pathname === "/" || pathname === "/catalog";
    }

    return pathname.startsWith(item.match.path);
  }

  return pathname === "/catalog" && searchParams.get(item.match.name) === item.match.value;
}

/**
 * Parses pathname and search parameters for link matching without requiring a full URL.
 */
function parseCurrentLocation(currentLocation: string): { pathname: string; searchParams: URLSearchParams } {
  try {
    const location = new URL(currentLocation, "https://ee-library.local");

    return {
      pathname: location.pathname,
      searchParams: location.searchParams
    };
  } catch {
    return {
      pathname: currentLocation.split("?")[0] || "/",
      searchParams: new URLSearchParams()
    };
  }
}
