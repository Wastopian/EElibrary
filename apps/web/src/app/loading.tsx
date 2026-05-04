/**
 * File header: Provides a global loading state for route transitions.
 */

/**
 * Renders a workstation-style loading state for route transitions.
 */
export default function Loading() {
  return (
    <section aria-live="polite" className="workspace-state">
      <div className="workspace-state__card workspace-state__card--review">
        <p className="workspace-state__eyebrow">Route state</p>
        <h1>Loading workspace</h1>
        <p>Preparing normalized component records, readiness evidence, and issue context so the next view stays aligned with real catalog truth.</p>
      </div>
    </section>
  );
}
