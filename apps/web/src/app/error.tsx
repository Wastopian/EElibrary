/**
 * File header: Provides a global recoverable error state for the web app.
 */

"use client";

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
    <section className="workspace-state">
      <div className="workspace-state__card workspace-state__card--danger">
        <p className="workspace-state__eyebrow">Route state</p>
        <h1>Workspace error</h1>
        <p>Something broke while preparing this route. Retry the request to reload the current engineering workspace without hiding the failure behind stale UI.</p>
        <div className="workspace-state__actions">
          <button onClick={reset} type="button">
            Retry
          </button>
        </div>
      </div>
    </section>
  );
}
