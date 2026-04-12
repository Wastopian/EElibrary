/**
 * File header: Provides a not-found state for missing component routes.
 */

import Link from "next/link";
import { EmptyState } from "@ee-library/ui";

/**
 * Renders a recovery path when a part cannot be found.
 */
export default function NotFound() {
  return (
    <div className="error-shell">
      <EmptyState body="The requested part is not in the current seeded records." title="Part not found" />
      <Link className="button-link" href="/">
        Return to search
      </Link>
    </div>
  );
}
