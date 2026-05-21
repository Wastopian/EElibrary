"use client";

/**
 * File header: Renders the shared workstation navigation for EE Library.
 *
 * Primary links stay visible for everyday work (projects, catalog search, compare).
 * Secondary workspaces and catalog filter shortcuts live in collapsible sections so
 * the sidebar stays calm for first-time engineers.
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

/** PRIMARY_NAVIGATION_ITEMS are the everyday engineer entry points. */
const PRIMARY_NAVIGATION_ITEMS: NavigationItem[] = [
  {
    description: "Your BOMs, files on disk, and parts in each design.",
    href: "/projects",
    label: "Projects",
    match: { path: "/projects", type: "path" }
  },
  {
    description: "Search the library when you need a part outside a project.",
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
    description: "See where a part or file is used across projects.",
    href: "/where-used",
    label: "Where-used",
    match: { path: "/where-used", type: "path" }
  }
];

/** MORE_NAVIGATION_ITEMS are useful but less frequent workspaces. */
const MORE_NAVIGATION_ITEMS: NavigationItem[] = [
  {
    description: "Remember PCB shops, sheet metal, and who you trust.",
    href: "/vendors",
    label: "Vendors",
    match: { path: "/vendors", type: "path" }
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
];

/** CATALOG_FILTER_ITEMS are saved catalog views; they always open /catalog with a filter. */
const CATALOG_FILTER_ITEMS: NavigationItem[] = [
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
];

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
  const moreWorkspaceOpen = MORE_NAVIGATION_ITEMS.some((item) => isNavigationItemActive(item, currentLocation));
  const catalogShortcutsOpen =
    CATALOG_FILTER_ITEMS.some((item) => isNavigationItemActive(item, currentLocation)) || parseCurrentLocation(currentLocation).pathname === "/catalog";

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      <NavigationGroupSection currentLocation={currentLocation} group={{ items: PRIMARY_NAVIGATION_ITEMS, label: "Start here" }} />

      <details className="app-nav__more" open={moreWorkspaceOpen || undefined}>
        <summary className="app-nav__more-summary">More workspaces</summary>
        <NavigationGroupSection currentLocation={currentLocation} group={{ items: MORE_NAVIGATION_ITEMS, label: "More" }} />
      </details>

      <details className="app-nav__more app-nav__more--filters" open={catalogShortcutsOpen || undefined}>
        <summary className="app-nav__more-summary">Catalog shortcuts</summary>
        <NavigationGroupSection currentLocation={currentLocation} filterLinks group={{ items: CATALOG_FILTER_ITEMS, label: "Catalog filters" }} />
      </details>
    </nav>
  );
}

/**
 * Renders one labeled navigation group with optional filter-link styling.
 */
function NavigationGroupSection({
  currentLocation,
  filterLinks = false,
  group
}: {
  currentLocation: string;
  filterLinks?: boolean;
  group: NavigationGroup;
}) {
  return (
    <section className={filterLinks ? "app-nav__group app-nav__group--filters" : "app-nav__group"}>
      <p className="app-nav__group-label">{group.label}</p>
      <div className="app-nav__group-links">
        {group.items.map((item) => {
          const isActive = isNavigationItemActive(item, currentLocation);
          const className = `${isActive ? "app-nav__link app-nav__link--active" : "app-nav__link"}${filterLinks ? " app-nav__link--filter" : ""}`;

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
}

/**
 * Determines whether one navigation item should render as active for the supplied location.
 */
function isNavigationItemActive(item: NavigationItem, currentLocation: string): boolean {
  const { pathname, searchParams } = parseCurrentLocation(currentLocation);

  if (item.match.type === "path") {
    if (item.match.path === "/projects") {
      return pathname === "/" || pathname === "/projects" || pathname.startsWith("/projects/");
    }

    if (item.match.path === "/catalog") {
      return pathname === "/catalog";
    }

    return pathname === item.match.path || pathname.startsWith(`${item.match.path}/`);
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
      searchParams: new URLSearchParams(currentLocation.includes("?") ? currentLocation.split("?")[1] : "")
    };
  }
}
