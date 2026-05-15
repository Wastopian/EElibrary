/**
 * Compare workspace side-by-side CAD preview band.
 *
 * Renders one row per CAD asset class (symbol, footprint, 3D model) with one preview
 * cell per compared part. Each cell delegates to the same `AssetInlinePreview` component
 * the part detail page uses, so the preview-state matrix stays consistent (a STEP
 * without a derived viewer artifact stays "preview pending artifact" here just as it
 * does on the detail page).
 *
 * Honesty rules:
 *  - Empty/missing asset classes render an explicit "No asset of this class" note
 *    rather than collapsing the cell, so a missing CAD class is visible in the diff.
 *  - The caller is expected to render the per-asset trust-stage diff row from
 *    `buildCompareAssetTrustRows` directly adjacent so engineers never confuse "preview
 *    renders" with "asset is approved or verified for export".
 */

import React from "react";
import Link from "next/link";
import { AssetInlinePreview } from "./AssetInlinePreview";
import type { ComparePreviewRow } from "../lib/part-compare";

type CompareAssetPreviewBandProps = {
  rows: ComparePreviewRow[];
};

export function CompareAssetPreviewBand({ rows }: CompareAssetPreviewBandProps) {
  const firstRow = rows[0];
  if (!firstRow || firstRow.cells.length === 0) {
    return null;
  }

  const headers = firstRow.cells.map((cell) => ({ partId: cell.partId, partMpn: cell.partMpn }));

  return (
    <div className="admin-table-wrap compare-table-wrap">
      <table className="admin-table compare-table compare-table--preview">
        <thead>
          <tr>
            <th scope="col">Asset class</th>
            {headers.map((header) => (
              <th key={header.partId} className="ui-mono" scope="col">
                <Link href={`/parts/${header.partId}`}>{header.partMpn}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell) => (
                <td key={`${row.rowKey}:${cell.partId}`} className="compare-preview-cell">
                  {cell.bestAsset ? (
                    <AssetInlinePreview asset={cell.bestAsset} partId={cell.partId} />
                  ) : (
                    <p className="muted-copy compare-preview-cell__missing">
                      No {row.label.toLowerCase()} asset recorded for this part.
                    </p>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
