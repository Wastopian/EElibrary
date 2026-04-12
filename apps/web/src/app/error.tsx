/**
 * File header: Provides a global recoverable error state for the web app.
 */

"use client";

import { EmptyState } from "@ee-library/ui";
import { useEffect } from "react";

/** ErrorProps exposes the Next.js recovery callback for route errors. */
interface ErrorProps {
  /** The error captured by the app router. */
  error: Error & { digest?: string };
  /** Callback that retries rendering the route. */
  reset: () => void;
}

/**
 * Renders an error recovery state with a retry action.
 */
export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="error-shell">
      <EmptyState body="Something broke while preparing this workspace. Retry the request." title="Workspace error" />
      <button onClick={reset} type="button">
        Retry
      </button>
    </div>
  );
}
