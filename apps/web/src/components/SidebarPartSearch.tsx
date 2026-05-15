/**
 * File header: Sidebar quick-search input that preserves any active catalog filters when used
 * from within the catalog workspace.
 *
 * The catalog hero search carries the current filter rail (manufacturer, category, package,
 * readiness, etc.) as hidden inputs so a query refinement does not silently drop facets the
 * engineer set up. The sidebar form is shown on every route, so historically it posted only `q`
 * and clobbered every facet the moment an engineer typed an MPN. Reading the live URL on the
 * client lets the sidebar carry those same hidden values when the user is already on
 * `/catalog`, while behaving normally everywhere else.
 *
 * Implementation note: we read `window.location` from a `useEffect` rather than
 * `next/navigation`'s `useSearchParams`. The root layout is shared by every route and forcing the
 * whole shell into a Suspense boundary just to read the URL adds rendering noise. The trade-off
 * is that hidden inputs are empty on the very first render (before hydration); this is invisible
 * to the user because the form has no UI for them anyway.
 */

"use client";

import React from "react";

/** Filter keys carried from the catalog page so the sidebar quick-search does not drop them. */
const CATALOG_FILTER_KEYS = [
  "manufacturerId",
  "category",
  "packageId",
  "lifecycleStatus",
  "cad",
  "readinessStatus",
  "approvalStatus",
  "connectorClass",
  "providerPartId",
  "providerUrl",
  "datasheetUrl",
  "sort",
  "pageSize"
] as const;

export function SidebarPartSearch(): React.ReactElement {
  const [carriedFilters, setCarriedFilters] = React.useState<Array<{ name: string; value: string }>>([]);

  React.useEffect(() => {
    function refresh() {
      if (typeof window === "undefined") return;
      const onCatalog = window.location.pathname.startsWith("/catalog");
      if (!onCatalog) {
        setCarriedFilters([]);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next: Array<{ name: string; value: string }> = [];
      for (const key of CATALOG_FILTER_KEYS) {
        const value = params.get(key);
        if (value) next.push({ name: key, value });
      }
      setCarriedFilters(next);
    }

    refresh();
    // History API mutations from filter rail submissions do not fire popstate, but full-page
    // navigations between routes do refresh this layout component. A popstate listener is enough
    // to keep back/forward navigation honest.
    window.addEventListener("popstate", refresh);
    return () => window.removeEventListener("popstate", refresh);
  }, []);

  return (
    <form action="/catalog" className="app-sidebar__search" method="get" role="search">
      <label className="app-sidebar__search-label" htmlFor="sidebar-search">
        Search a part number
      </label>
      <input
        aria-label="Search the catalog by part number"
        autoComplete="off"
        className="app-sidebar__search-input"
        id="sidebar-search"
        name="q"
        placeholder="MPN or keyword"
        type="search"
      />
      {carriedFilters.map(({ name, value }) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      {carriedFilters.length > 0 ? (
        <p className="app-sidebar__search-hint muted-copy">
          Active catalog filters carried over.
        </p>
      ) : null}
    </form>
  );
}
