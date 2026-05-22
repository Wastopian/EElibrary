/**
 * File header: Collapsible panel built on native <details> so wordy, low-frequency sections
 * stay out of the way until an engineer opens them. No client JS - the disclosure is native.
 */

import React from "react";

interface CollapsibleSectionProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  description?: string;
  title: string;
}

/**
 * Renders a titled, collapsible section that matches the SectionPanel surface but hides its
 * body behind a click. Collapsed by default to reduce scroll on dense detail pages.
 */
export function CollapsibleSection({ children, defaultOpen = false, description, title }: CollapsibleSectionProps) {
  return (
    <details className="collapsible-section" open={defaultOpen}>
      <summary className="collapsible-section__summary">
        <span className="collapsible-section__heading">
          <span className="collapsible-section__title">{title}</span>
          {description ? <span className="collapsible-section__hint">{description}</span> : null}
        </span>
      </summary>
      <div className="collapsible-section__body">{children}</div>
    </details>
  );
}
