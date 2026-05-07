/**
 * File header: Renders plain cross-workspace action links for long engineering workspaces.
 */

import Link from "next/link";
import React from "react";

/** WorkspaceAction describes one operator-facing jump into a related workflow. */
export type WorkspaceAction = {
  body: string;
  href: string;
  label: string;
  signal: string;
};

/** WorkspaceActionPanelProps keeps the panel copy and route targets explicit. */
interface WorkspaceActionPanelProps {
  actions: WorkspaceAction[];
  description: string;
  title: string;
}

/**
 * Renders related-workspace links with short labels so operators do not need to edit URLs by hand.
 */
export function WorkspaceActionPanel({ actions, description, title }: WorkspaceActionPanelProps) {
  return (
    <section aria-label={title} className="workspace-action-panel">
      <div className="workspace-action-panel__header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="workspace-action-panel__grid">
        {actions.map((action) => (
          <Link className="workspace-action-card" href={action.href} key={`${action.label}:${action.href}`}>
            <span className="workspace-action-card__signal">{action.signal}</span>
            <strong>{action.label}</strong>
            <p>{action.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
