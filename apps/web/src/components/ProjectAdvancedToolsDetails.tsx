/**
 * Wraps the project detail "Advanced project tools" disclosure so deep links into any
 * section inside it actually reveal the region (native `<details>` stays closed otherwise).
 */

"use client";

import React, { useLayoutEffect, useState, type ReactNode } from "react";

/**
 * Hash targets that live inside the advanced disclosure. Keep in sync with SectionHeading
 * ids under `apps/web/src/app/projects/[projectId]/page.tsx` advanced block only.
 */
export const PROJECT_ADVANCED_SECTION_HASHES = new Set([
  "#advanced-project-tools",
  "#project-summary-heading",
  "#project-edit-heading",
  "#project-revisions-heading",
  "#project-bom-imports-heading",
  "#project-bom-diagnostics-heading",
  "#project-revision-gates-heading",
  "#project-circuit-block-instantiation-heading",
  "#project-risk-heading",
  "#project-approval-batch-heading",
  "#project-export-bundles-heading",
  "#project-follow-ups-heading",
  "#project-evidence-heading",
  "#project-capabilities-heading"
]);

type ProjectAdvancedToolsDetailsProps = {
  children: ReactNode;
};

export function ProjectAdvancedToolsDetails({ children }: ProjectAdvancedToolsDetailsProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const syncHash = (): void => {
      if (PROJECT_ADVANCED_SECTION_HASHES.has(window.location.hash)) {
        setOpen(true);
      }
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <details className="projects-advanced" id="advanced-project-tools" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      {children}
    </details>
  );
}
