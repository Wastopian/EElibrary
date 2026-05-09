"use client";

/**
 * File header: Renders the vendor list with a client-side search filter.
 *
 * Engineers commonly want to ask "have we used a sheet metal shop on the east coast?"
 * The search input narrows the list by name, category, and summary so that question is
 * answered without leaving the page. Vendors are grouped by category so the layout
 * stays scannable even with a large notebook.
 */

import Link from "next/link";
import React, { useMemo, useState } from "react";
import type { VendorCategory, VendorSummary } from "@ee-library/shared/types";

interface VendorsBrowserProps {
  /** Vendor summaries returned by the API in their server-provided order. */
  vendors: VendorSummary[];
}

/**
 * VENDOR_CATEGORY_LABELS mirrors the canonical labels rendered elsewhere so the list
 * groups match the create form and the detail page tone.
 */
const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  pcb_fab: "PCB fab",
  sheet_metal: "Sheet metal",
  machining: "Machining",
  finishing: "Anodize / finishing",
  electronics_assembly: "Electronics assembly",
  distributor: "Distributor",
  other: "Other"
};

/** VENDOR_CATEGORY_ORDER preserves UI grouping order without depending on Object.entries(). */
const VENDOR_CATEGORY_ORDER: VendorCategory[] = [
  "pcb_fab",
  "sheet_metal",
  "machining",
  "finishing",
  "electronics_assembly",
  "distributor",
  "other"
];

type CategoryFilter = "all" | VendorCategory;

/**
 * Renders category chips plus a search input so engineers can scan or filter quickly.
 */
export function VendorsBrowser({ vendors }: VendorsBrowserProps) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const filtered = useMemo(
    () => filterVendors(vendors, query, categoryFilter),
    [categoryFilter, query, vendors]
  );
  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  const chipCounts = useMemo(() => countByCategory(vendors), [vendors]);

  return (
    <div className="vendors-browser">
      <div className="vendors-browser__chips" role="group" aria-label="Filter by supplier type">
        <button
          className={
            categoryFilter === "all"
              ? "vendors-browser__chip vendors-browser__chip--active"
              : "vendors-browser__chip"
          }
          onClick={() => setCategoryFilter("all")}
          type="button"
        >
          All ({vendors.length})
        </button>
        {VENDOR_CATEGORY_ORDER.map((category) => {
          const count = chipCounts.get(category) ?? 0;
          if (count === 0) {
            return null;
          }
          const active = categoryFilter === category;
          return (
            <button
              className={active ? "vendors-browser__chip vendors-browser__chip--active" : "vendors-browser__chip"}
              key={category}
              onClick={() => setCategoryFilter(category)}
              type="button"
            >
              {VENDOR_CATEGORY_LABELS[category]} ({count})
            </button>
          );
        })}
      </div>

      <label className="vendors-browser__search">
        <span>Find a supplier</span>
        <input
          autoComplete="off"
          name="vendor-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Company name, or words like PCB, anodize, sheet metal…"
          type="search"
          value={query}
        />
      </label>
      <p className="vendors-browser__count muted-copy">
        {query || categoryFilter !== "all"
          ? `${filtered.length} showing${vendors.length !== filtered.length ? ` (${vendors.length} total)` : ""}`
          : `${vendors.length} supplier${vendors.length === 1 ? "" : "s"}`}
      </p>

      {filtered.length === 0 ? (
        <p className="vendors-browser__empty">
          Nothing matches. Try another type above, or clear the search box.
        </p>
      ) : (
        <div className="vendors-browser__groups">
          {VENDOR_CATEGORY_ORDER.map((category) => {
            const summaries = grouped.get(category) ?? [];
            if (summaries.length === 0) {
              return null;
            }
            return (
              <section className="vendors-browser__group" key={category}>
                <h3 className="vendors-browser__group-label">{VENDOR_CATEGORY_LABELS[category]}</h3>
                <ul className="vendors-browser__list">
                  {summaries.map((summary) => (
                    <li className="vendors-browser__row" key={summary.vendor.slug}>
                      <div className="vendors-browser__primary">
                        <Link className="vendors-browser__link" href={`/vendors/${encodeURIComponent(summary.vendor.slug)}`}>
                          {summary.vendor.name}
                        </Link>
                        {summary.vendor.summary ? (
                          <p className="vendors-browser__summary muted-copy">{summary.vendor.summary}</p>
                        ) : null}
                      </div>
                      <div className="vendors-browser__counts muted-copy">
                        <span>
                          <strong>{summary.noteCount}</strong> {summary.noteCount === 1 ? "note" : "notes"}
                        </span>
                        <span>
                          <strong>{summary.fileCount}</strong> {summary.fileCount === 1 ? "file" : "files"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Filters by category chip first, then by case-insensitive substring search. */
function filterVendors(vendors: VendorSummary[], rawQuery: string, categoryFilter: CategoryFilter): VendorSummary[] {
  const list =
    categoryFilter === "all" ? vendors : vendors.filter((summary) => summary.vendor.category === categoryFilter);

  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return list;
  }

  return list.filter((summary) => {
    const haystack = [
      summary.vendor.name,
      summary.vendor.slug,
      summary.vendor.summary,
      VENDOR_CATEGORY_LABELS[summary.vendor.category]
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

/** Returns how many vendors exist in each category for chip labels. */
function countByCategory(vendors: VendorSummary[]): Map<VendorCategory, number> {
  const counts = new Map<VendorCategory, number>();
  for (const summary of vendors) {
    const key = summary.vendor.category;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Groups summaries by category preserving original list order inside each group. */
function groupByCategory(summaries: VendorSummary[]): Map<VendorCategory, VendorSummary[]> {
  const groups = new Map<VendorCategory, VendorSummary[]>();
  for (const summary of summaries) {
    const list = groups.get(summary.vendor.category) ?? [];
    list.push(summary);
    groups.set(summary.vendor.category, list);
  }
  return groups;
}
