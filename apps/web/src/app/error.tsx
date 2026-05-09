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
        <p className="workspace-state__eyebrow">Something went wrong</p>
        <h1>This page hit an error.</h1>
        <p>It is not something you did. Retry to reload the page. If it keeps failing, open System to see what is offline.</p>
        <div className="workspace-state__actions">
          <button onClick={reset} type="button">
            Retry
          </button>
          <a className="button-link button-link--quiet" href="/system">
            Open System
          </a>
        </div>
      </div>
    </section>
  );
}
