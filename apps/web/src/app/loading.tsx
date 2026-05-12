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
        <p className="workspace-state__eyebrow">One moment</p>
        <h1>Loading...</h1>
        <p>Pulling the latest part records, files, and review state for this view.</p>
      </div>
    </section>
  );
}
