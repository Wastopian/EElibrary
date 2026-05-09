/**
 * File header: Renders a compact first-time operator checklist with one primary action.
 */

import Link from "next/link";
import React from "react";

export type OperatorChecklistStep = {
  label: string;
  detail: string;
};

interface OperatorChecklistProps {
  title: string;
  summary: string;
  steps: OperatorChecklistStep[];
  primaryActionHref: string;
  primaryActionLabel: string;
}

/**
 * Provides a concise task order for first-time operators.
 */
export function OperatorChecklist({
  title,
  summary,
  steps,
  primaryActionHref,
  primaryActionLabel
}: OperatorChecklistProps) {
  return (
    <section aria-label={title} className="operator-checklist">
      <div className="operator-checklist__header">
        <p className="app-kicker">Getting started</p>
        <h2>{title}</h2>
        <p>{summary}</p>
      </div>
      <ol className="operator-checklist__steps">
        {steps.map((step) => (
          <li key={step.label}>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className="operator-checklist__actions">
        <Link className="button-link" href={primaryActionHref}>
          {primaryActionLabel}
        </Link>
      </div>
    </section>
  );
}
