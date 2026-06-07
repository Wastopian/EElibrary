/**
 * File header: Renders local review actions for one reviewable asset or workflow.
 */

import type { ReviewStatusSummary, ReviewTargetType } from "@ee-library/shared/types";
import { shouldRenderReviewActions } from "../../../../lib/detail-view-model";
import React from "react";

/**
 * Renders local review actions for one reviewable asset or workflow.
 */
export function ReviewActionPanel({ reviewAction, reviewStatus, targetId, targetType }: { reviewAction: (formData: FormData) => Promise<void>; reviewStatus: ReviewStatusSummary; targetId: string; targetType: ReviewTargetType }) {
  if (!shouldRenderReviewActions(reviewStatus)) {
    return null;
  }

  return (
    <form action={reviewAction} className="review-action-panel">
      <input name="targetId" type="hidden" value={targetId} />
      <input name="targetType" type="hidden" value={targetType} />
      <span>Local review (dev)</span>
      <button name="outcome" type="submit" value="approved">
        Approve
      </button>
      <button name="outcome" type="submit" value="changes_requested">
        Request changes
      </button>
      <button name="outcome" type="submit" value="rejected">
        Reject
      </button>
    </form>
  );
}
