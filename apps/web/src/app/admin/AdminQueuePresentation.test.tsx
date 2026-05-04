/**
 * File header: Tests the interactive admin queue presentation over backend-backed grouped and table projections.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminQueuePresentation } from "./AdminQueuePresentation";

/**
 * Verifies grouped mode renders backend-backed queue buckets without placeholder categories.
 */
test("admin queue presentation renders grouped mode with backend-backed issue queues", () => {
  const html = renderToStaticMarkup(
    <AdminQueuePresentation
      groups={[
        {
          count: 3,
          description: "Generated assets waiting for review.",
          id: "review",
          label: "Generated drafts and review-required outputs",
          tone: "review"
        },
        {
          count: 2,
          description: "Whole-part approval still needs follow-up.",
          id: "approval",
          label: "Pending approval",
          tone: "info"
        }
      ]}
      rows={[]}
      stats={[{ label: "Review items", tone: "review", value: 3 }]}
    />
  );

  assert.match(html, /Grouped/u);
  assert.match(html, /Table/u);
  assert.match(html, /All items/u);
  assert.match(html, /Generated drafts and review-required outputs/u);
  assert.match(html, /Pending approval/u);
  assert.match(html, /Open queue/u);
  assert.doesNotMatch(html, /Unavailable/u);
});

/**
 * Verifies table mode renders a dense flat list from supported queue rows only.
 */
test("admin queue presentation renders table mode with backend-backed rows", () => {
  const html = renderToStaticMarkup(
    <AdminQueuePresentation
      groups={[
        {
          count: 1,
          description: "Generated assets waiting for review.",
          id: "review",
          label: "Generated drafts and review-required outputs",
          tone: "review"
        },
        {
          count: 1,
          description: "Whole-part approval still needs follow-up.",
          id: "approval",
          label: "Pending approval",
          tone: "info"
        }
      ]}
      initialMode="table"
      rows={[
        {
          detail: "Generated draft requires explicit review outcome.",
          href: "/parts/part-1",
          id: "review-asset-1",
          manufacturerName: "TE Connectivity",
          mpn: "215079-8",
          queueId: "review",
          queueLabel: "Review queue",
          stateLabel: "pending review",
          stateTone: "review",
          updatedLabel: "Apr 20, 2026"
        },
        {
          detail: "Approval has not been requested yet, so the part should not be treated as engineer-ready.",
          href: "/parts/part-2",
          id: "approval-part-2",
          manufacturerName: "Texas Instruments",
          mpn: "TPS7A02DBVR",
          queueId: "approval",
          queueLabel: "Pending approval",
          stateLabel: "Approval not requested",
          stateTone: "review",
          updatedLabel: "Apr 21, 2026"
        }
      ]}
      stats={[
        { label: "Review items", tone: "review", value: 1 },
        { label: "Pending approval", tone: "info", value: 1 }
      ]}
    />
  );

  assert.match(html, /All items/u);
  assert.match(html, /Review queue/u);
  assert.match(html, /Pending approval/u);
  assert.match(html, /backend-backed rows in/u);
  assert.match(html, /215079-8/u);
  assert.match(html, /TPS7A02DBVR/u);
  assert.doesNotMatch(html, /Duplicate candidates/u);
});
