/**
 * File header: Renders the separate verified-for-export promotion action when review has earned it.
 */

import type { Asset, AssetPromotionSummary } from "@ee-library/shared/types";
import { shouldRenderAssetPromotionAction } from "../../../../lib/detail-view-model";
import React from "react";

/**
 * Renders the separate verified-for-export promotion action when review has earned it.
 */
export function AssetPromotionPanel({ asset, promotionAction, promotionSummary }: { asset: Asset; promotionAction: (formData: FormData) => Promise<void>; promotionSummary: AssetPromotionSummary }) {
  if (!shouldRenderAssetPromotionAction(promotionSummary)) {
    return null;
  }

  return (
    <form action={promotionAction} className="review-action-panel">
      <input name="assetId" type="hidden" value={asset.id} />
      <span>Export promotion</span>
      <button type="submit">Promote to verified for export</button>
    </form>
  );
}
