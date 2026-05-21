/**
 * File header: Provides a not-found state for missing component routes.
 */

import Link from "next/link";

/**
 * Renders a recovery path when a part cannot be found.
 */
export default function NotFound() {
  return (
    <section className="workspace-state">
      <div className="workspace-state__card">
        <p className="workspace-state__eyebrow">Page not found</p>
        <h1>We could not find that part.</h1>
        <p>It may have been removed, the link may be wrong, or the part has not been imported yet. Open your projects or search the catalog for the manufacturer part number.</p>
        <div className="workspace-state__actions">
          <Link className="button-link" href="/">
            Open projects
          </Link>
          <Link className="button-link button-link--quiet" href="/catalog">
            Search catalog
          </Link>
        </div>
      </div>
    </section>
  );
}
