"use client";

/**
 * File header: Renders the shared workstation navigation for EE Library.
 */

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
  const [currentLocation, setCurrentLocation] = React.useState<string>("/");

  React.useEffect(() => {
    /**
     * Reads the browser location so active route styling still works without
     * pushing routing logic down into unrelated page components.
     */
    function updateCurrentLocation() {
      if (typeof window === "undefined") {
        return;
      }

      const pathname = window.location.pathname || "/";
      const search = window.location.search || "";
      setCurrentLocation(`${pathname}${search}`);
    }

    updateCurrentLocation();
    window.addEventListener("popstate", updateCurrentLocation);

    return () => {
      window.removeEventListener("popstate", updateCurrentLocation);
    };
  }, []);

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
          description: "Quick readiness checks, recent records, and engineering-first search filters.",
          href: "/catalog",
          label: "Catalog workspace",
          match: { path: "/catalog", type: "path" }
        },
        {
          description: "Issue operations, review queues, import history, and promotion workflow.",
          href: "/admin",
          label: "Admin review queue",
          match: { path: "/admin", type: "path" }
        }
      ],
      label: "Workspaces"
    },
    {
      items: [
        {
          description: "Connector records with mates, accessories, cable assumptions, and family warnings in view.",
          href: "/catalog?category=Connector",
          label: "Connector coverage",
          match: { name: "category", type: "query", value: "Connector" }
        },
        {
          description: "Records missing verified file-backed CAD for export workflows.",
          href: "/catalog?cad=unavailable",
          label: "Missing verified CAD",
          match: { name: "cad", type: "query", value: "unavailable" }
        },
        {
          description: "Parts still waiting on a design-use approval decision.",
          href: "/catalog?approvalStatus=pending_review",
          label: "Pending approval",
          match: { name: "approvalStatus", type: "query", value: "pending_review" }
        }
      ],
      label: "Library views"
    }
  ];

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      {groups.map((group) => (
        <section className="app-nav__group" key={group.label}>
          <p className="app-nav__group-label">{group.label}</p>
          <div className="app-nav__group-links">
            {group.items.map((item) => {
              const isActive = isNavigationItemActive(item, currentLocation);

              return (
                <a aria-current={isActive ? "page" : undefined} className={isActive ? "app-nav__link app-nav__link--active" : "app-nav__link"} href={item.href} key={item.href}>
                  <span className="app-nav__link-label">{item.label}</span>
                  <span className="app-nav__link-description">{item.description}</span>
                </a>
              );
            })}
          </div>
        </section>
      ))}
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
      return pathname === "/catalog" || pathname.startsWith("/parts/");
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
