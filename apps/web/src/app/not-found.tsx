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
        <h1>We can't find that page.</h1>
        <p>The link may be wrong, or the page may have moved. Head back to your projects, or search the catalog if you are looking for a part.</p>
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
