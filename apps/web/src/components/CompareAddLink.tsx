/**
 * File header: Client-side "Compare with another part" link that merges the current part into
 * any compare basket the user has already built up.
 *
 * The compare selection lives in the URL (`/compare?parts=…`) and is also mirrored to
 * sessionStorage by `CompareSelectionTray` so it survives navigation to a part-detail page and
 * back. Without that merge the part-detail link would silently replace the user's existing basket
 * with just the current part id, which is one of the most reported frictions in the workspace.
 */

"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { buildCompareUrl } from "../lib/api-client";

export const COMPARE_BASKET_STORAGE_KEY = "ee-library:compare-basket";

/**
 * Reads the persisted compare basket from sessionStorage. Returns an empty list when storage is
 * unavailable (SSR), empty, or holds malformed JSON -- the link still works, it just falls back
 * to a single-part compare like the prior server-rendered behavior.
 */
export function readPersistedCompareBasket(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(COMPARE_BASKET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

/**
 * Renders a Link that merges `partId` into the persisted compare basket. The href is computed
 * after mount so that during SSR the link still works (falls back to a single-part compare).
 */
export function CompareAddLink({
  children,
  className,
  partId
}: {
  children: React.ReactNode;
  className?: string;
  partId: string;
}): React.ReactElement {
  const [basket, setBasket] = useState<string[]>([]);

  useEffect(() => {
    setBasket(readPersistedCompareBasket());
  }, []);

  return (
    <Link className={className} href={buildCompareUrl([...basket, partId])}>
      {children}
    </Link>
  );
}
