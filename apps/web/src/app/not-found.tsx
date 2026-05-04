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
        <p className="workspace-state__eyebrow">Route state</p>
        <h1>Part not found</h1>
        <p>The requested part is not available in the current catalog window. Return to the search workspace and use the quick readiness flow or filters to locate another record.</p>
        <div className="workspace-state__actions">
          <Link className="button-link" href="/">
            Return to search
          </Link>
          <Link className="button-link button-link--quiet" href="/admin">
            Open admin queue
          </Link>
        </div>
      </div>
    </section>
  );
}
