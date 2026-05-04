"use client";

/**
 * File header: Renders an interactive V3-style admin queue presentation over real backend-derived queues.
 */

import React, { useMemo, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";

/** AdminQueueOverviewStat keeps compact queue totals typed for the interactive overview. */
export type AdminQueueOverviewStat = {
  label: string;
  tone: BadgeTone;
  value: number;
};

/** AdminQueueOverviewGroup represents one grouped queue bucket backed by current backend data. */
export type AdminQueueOverviewGroup = {
  count: number;
  description: string;
  id: string;
  label: string;
  tone: BadgeTone;
};

/** AdminQueueTableRow flattens supported queues into one dense table view. */
export type AdminQueueTableRow = {
  detail: string;
  href: string;
  id: string;
  mpn: string;
  manufacturerName: string;
  queueId: string;
  queueLabel: string;
  stateLabel: string;
  stateTone: BadgeTone;
  updatedLabel: string;
};

/** AdminQueuePresentationProps provides grouped and table-ready queue projections from the server page. */
type AdminQueuePresentationProps = {
  groups: AdminQueueOverviewGroup[];
  initialMode?: "grouped" | "table";
  rows: AdminQueueTableRow[];
  stats: AdminQueueOverviewStat[];
};

/**
 * Renders grouped cards and a dense table mode without inventing unsupported queue categories.
 */
export function AdminQueuePresentation({ groups, initialMode = "grouped", rows, stats }: AdminQueuePresentationProps) {
  const [mode, setMode] = useState<"grouped" | "table">(initialMode);
  const [activeGroupId, setActiveGroupId] = useState<string>("all");
  const activeGroup = groups.find((group) => group.id === activeGroupId);
  const visibleGroups = activeGroupId === "all" ? groups : groups.filter((group) => group.id === activeGroupId);
  const filteredRows = useMemo(
    () => (activeGroupId === "all" ? rows : rows.filter((row) => row.queueId === activeGroupId)),
    [activeGroupId, rows]
  );

  return (
    <section aria-labelledby="admin-queue-overview-heading" className="admin-queue-overview">
      <div className="admin-queue-overview__header">
        <div>
          <p className="app-kicker">Admin</p>
          <h2 id="admin-queue-overview-heading">Operations queues</h2>
          <p>Grouped by real review, promotion, approval, issue, import, and validation state. Queues only appear when the backend records them.</p>
        </div>
        <div className="admin-queue-overview__controls">
          <div className="admin-queue-overview__mode" aria-label="Queue presentation mode">
            <button aria-pressed={mode === "grouped"} onClick={() => setMode("grouped")} type="button">
              Grouped
            </button>
            <button aria-pressed={mode === "table"} onClick={() => setMode("table")} type="button">
              Table
            </button>
          </div>
        </div>
      </div>

      <div className="admin-queue-stats" aria-label="Review queue counts">
        {stats.map((stat) => (
          <AdminQueueStat key={stat.label} label={stat.label} tone={stat.tone} value={stat.value} />
        ))}
      </div>

      <div className="admin-queue-overview__toolbar">
        <div className="admin-queue-filter" aria-label="Filter queue buckets">
          <button aria-pressed={activeGroupId === "all"} onClick={() => setActiveGroupId("all")} type="button">
            All items
          </button>
          {groups.map((group) => (
            <button aria-pressed={activeGroupId === group.id} key={group.id} onClick={() => setActiveGroupId(group.id)} type="button">
              {group.label}
            </button>
          ))}
        </div>
        <p>{activeGroupId === "all" ? `${rows.length} backend-backed rows across current queues` : `${filteredRows.length} backend-backed rows in ${activeGroup?.label ?? "the selected queue"}`}</p>
      </div>

      {mode === "grouped" ? (
        <div className="admin-queue-groups">
          {visibleGroups.map((group) => (
            <AdminQueueGroup
              count={group.count}
              description={group.description}
              key={group.id}
              label={group.label}
              onOpen={() => {
                setActiveGroupId(group.id);
                setMode("table");
              }}
              tone={group.tone}
            />
          ))}
        </div>
      ) : (
        <div className="admin-queue-table-view">
          <div className="admin-queue-table-view__toolbar">
            <p>Dense mode keeps queue, state, detail, and action truth visible together.</p>
          </div>

          {filteredRows.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--dense">
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th>Part</th>
                    <th>State</th>
                    <th>Detail</th>
                    <th>Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.queueLabel}</td>
                      <td>
                        <a href={row.href}>
                          <span className="ui-mono">{row.mpn}</span>
                        </a>
                        <div className="muted-copy">{row.manufacturerName}</div>
                      </td>
                      <td>
                        <StatusBadge label={row.stateLabel} tone={row.stateTone} />
                      </td>
                      <td>{row.detail}</td>
                      <td>{row.updatedLabel}</td>
                      <td>
                        <a className="button-link button-link--quiet" href={row.href}>
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-queue-table-view__empty">
              <strong>No rows for this queue filter</strong>
              <p>The current admin view does not have backend-backed rows for this filter.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Renders one compact admin queue statistic.
 */
function AdminQueueStat({ label, tone, value }: { label: string; tone: BadgeTone; value: number }) {
  return (
    <div className={`admin-queue-stat admin-queue-stat--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/**
 * Renders one grouped queue card and lets operators jump straight into the filtered dense view.
 */
function AdminQueueGroup({ count, description, label, onOpen, tone }: { count: number; description: string; label: string; onOpen: () => void; tone: BadgeTone }) {
  return (
    <article className={`admin-queue-group admin-queue-group--${tone}`}>
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      <div className="admin-queue-group__actions">
        <StatusBadge label={`${count} items`} tone={tone} />
        <button className="button-link button-link--quiet" onClick={onOpen} type="button">
          Open queue
        </button>
      </div>
    </article>
  );
}
