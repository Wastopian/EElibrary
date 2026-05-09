/**
 * File header: Defines reusable dark-mode UI primitives without provider-specific logic.
 */

import React, { type ReactNode } from "react";

/** BadgeTone maps domain state into visual emphasis without embedding domain rules. */
export type BadgeTone = "neutral" | "info" | "verified" | "review" | "danger" | "generated";

/** StatusBadgeProps defines a concise status label for dense engineering screens. */
export interface StatusBadgeProps {
  /** User-facing status label. */
  label: string;
  /** Visual tone selected by the consuming domain layer. */
  tone?: BadgeTone;
}

/** SectionPanelProps wraps a coherent block of detail content. */
export interface SectionPanelProps {
  /** Panel title. */
  title: string;
  /** Optional short description or provenance hint. */
  description?: string;
  /** Optional visual tone for default or technical surfaces. */
  tone?: "default" | "technical";
  /** Panel body content. */
  children: ReactNode;
}

/** EmptyStateProps presents clear empty, loading, or recovery copy. */
export interface EmptyStateProps {
  /** Empty state title. */
  title: string;
  /** Empty state supporting text. */
  body: string;
}

/** MetricTableRow keeps metric rendering provider-neutral. */
export interface MetricTableRow {
  /** Display label for the normalized metric. */
  label: string;
  /** Display value including normalized unit. */
  value: string;
  /** Confidence or provenance label. */
  meta: string;
  /** Visual tone selected by the consuming domain layer. */
  tone: BadgeTone;
}

/** MetricTableProps renders normalized metrics with confidence metadata. */
export interface MetricTableProps {
  /** Rows prepared by the domain layer. */
  rows: MetricTableRow[];
}

/** AssetCardProps renders an asset summary without knowing provider internals. */
export interface AssetCardProps {
  /** Display title for the asset. */
  title: string;
  /** File format label. */
  fileFormat: string;
  /** Validation label. */
  validationLabel: string;
  /** Preview readiness label. */
  previewLabel: string;
  /** Optional review-state label for reviewer-facing workflows. */
  reviewLabel?: string;
  /** Availability label derived from real storage state. */
  availabilityLabel: string;
  /** Availability tone selected by the consuming domain layer. */
  availabilityTone: BadgeTone;
  /** Validation tone selected by the consuming domain layer. */
  validationTone: BadgeTone;
  /** Preview tone selected by the consuming domain layer. */
  previewTone: BadgeTone;
  /** Optional review tone selected by the consuming domain layer. */
  reviewTone?: BadgeTone;
  /** Optional source attribution label supplied by the domain layer. */
  sourceLabel?: string;
  /** Optional last-updated label supplied by the domain layer. */
  updatedLabel?: string;
}

/** TrustMeterProps renders a compact trust score with explicit uncertainty. */
export interface TrustMeterProps {
  /** Trust score from 0 to 1. */
  score: number;
  /** User-facing label for the trust score. */
  label: string;
  /** Visual tone selected by the consuming domain layer. */
  tone: BadgeTone;
}

/**
 * Renders a compact status badge.
 */
export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`ui-badge ui-badge--${tone}`}>{label}</span>;
}

/** SectionHeadingProps renders an editorial section title for workspace pages. */
export interface SectionHeadingProps {
  /** Stable id for aria-labelledby. */
  id: string;
  /** Optional short section index label such as "01"; omitted when sections are not numbered. */
  index?: string;
  /** Primary section title. */
  title: string;
  /** Optional supporting line under the title. */
  subtitle?: string;
}

/**
 * Renders a section heading for long-form detail layouts. The index column collapses
 * cleanly when no index is provided, so cleaned-up workspace pages can drop the numeric
 * label without losing alignment.
 */
export function SectionHeading({ id, index, subtitle, title }: SectionHeadingProps) {
  return (
    <header className="ui-section-heading" id={id}>
      {index ? (
        <span aria-hidden className="ui-section-heading__index">
          {index}
        </span>
      ) : null}
      <div>
        <h2 className="ui-section-heading__title">{title}</h2>
        {subtitle ? <p className="ui-section-heading__subtitle">{subtitle}</p> : null}
      </div>
    </header>
  );
}

/**
 * Renders a reusable panel with optional context copy.
 */
export function SectionPanel({ children, description, title, tone = "default" }: SectionPanelProps) {
  return (
    <section className={`ui-panel ui-panel--${tone}`}>
      <div className="ui-panel__header">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Renders an empty or fallback state block.
 */
export function EmptyState({ body, title }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

/**
 * Renders normalized metric rows with confidence labels.
 */
export function MetricTable({ rows }: MetricTableProps) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
            <th>Source confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="ui-mono">{row.value}</td>
              <td>
                <StatusBadge label={row.meta} tone={row.tone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders an asset metadata card with explicit provider-neutral asset state.
 */
export function AssetCard({
  availabilityLabel,
  availabilityTone,
  fileFormat,
  previewLabel,
  previewTone,
  reviewLabel,
  reviewTone = "neutral",
  sourceLabel,
  title,
  updatedLabel,
  validationLabel,
  validationTone
}: AssetCardProps) {
  return (
    <article className="ui-asset-card">
      <div className="ui-asset-card__header">
        <div className="ui-asset-card__identity">
          <span className="ui-asset-card__eyebrow">Asset class</span>
          <h3>{title}</h3>
        </div>
        <span className="ui-asset-card__format ui-mono">{fileFormat}</span>
      </div>
      <div className="ui-asset-card__status-grid">
        <div className="ui-asset-card__status-item">
          <span className="ui-asset-card__status-label">Validation</span>
          <StatusBadge label={validationLabel} tone={validationTone} />
        </div>
        {reviewLabel ? (
          <div className="ui-asset-card__status-item">
            <span className="ui-asset-card__status-label">Review</span>
            <StatusBadge label={reviewLabel} tone={reviewTone} />
          </div>
        ) : null}
        <div className="ui-asset-card__status-item">
          <span className="ui-asset-card__status-label">Preview</span>
          <StatusBadge label={previewLabel} tone={previewTone} />
        </div>
        <div className="ui-asset-card__status-item">
          <span className="ui-asset-card__status-label">Availability</span>
          <StatusBadge label={availabilityLabel} tone={availabilityTone} />
        </div>
      </div>
      {sourceLabel || updatedLabel ? (
        <dl className="ui-asset-card__meta">
          {sourceLabel ? (
            <div>
              <dt>Source</dt>
              <dd>{sourceLabel}</dd>
            </div>
          ) : null}
          {updatedLabel ? (
            <div>
              <dt>Updated</dt>
              <dd>{updatedLabel}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}

/**
 * Renders a trust score meter using explicit score text and bar fill.
 */
export function TrustMeter({ label, score, tone }: TrustMeterProps) {
  const percent = Math.round(score * 100);

  return (
    <div className="ui-trust-meter">
      <div className="ui-trust-meter__label">
        <span>{label}</span>
        <strong>{percent}%</strong>
      </div>
      <div aria-label={`${label} ${percent}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} className="ui-trust-meter__track" role="meter">
        <span className={`ui-trust-meter__bar ui-trust-meter__bar--${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
