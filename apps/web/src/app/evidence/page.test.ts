/**
 * File header: Tests the evidence vault workspace rendering against API evidence contracts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import EvidencePage from "./page";
import type { EvidenceAttachmentListResponse } from "@ee-library/shared/types";

/**
 * Verifies the evidence vault renders filters, upload target controls, and review rows.
 */
test("evidence vault renders filters and review rows without trust overclaims", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "connected",
          objectStorage: "local",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    if (url.pathname === "/evidence-attachments") {
      return jsonResponse({
        data: buildEvidenceVaultResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({ storageState: "file_backed" }) }));

    assert.match(html, /Evidence provenance and review/u);
    assert.match(html, /Vault filters/u);
    assert.match(html, /Attach evidence/u);
    assert.match(html, /Review PDF/u);
    assert.match(html, /File-backed/u);
    assert.match(html, /Accepted evidence is not validation/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Replaces global fetch with an evidence page API handler.
 */
function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Builds a JSON Response with stable headers for the API client.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}

/**
 * Builds one file-backed evidence vault response.
 */
function buildEvidenceVaultResponse(): EvidenceAttachmentListResponse {
  return {
    attachments: [
      {
        createdAt: "2026-05-02T12:00:00.000Z",
        evidenceType: "file",
        fileHash: "abc123",
        id: "evidence-review-pdf",
        mimeType: "application/pdf",
        notes: "Uploaded design review PDF.",
        provenance: "manual_internal",
        reviewStatus: "unreviewed",
        sourceUrl: null,
        storageKey: "evidence/project/project-alpha/abc123-review.pdf",
        targetId: "project-alpha",
        targetType: "project",
        title: "Review PDF",
        updatedAt: "2026-05-02T12:00:00.000Z",
        uploadedBy: "test-admin"
      }
    ],
    boundary: "Evidence review is provenance review only; it does not approve parts, validate assets, or unlock export.",
    filters: {
      storageState: "file_backed"
    },
    state: "available",
    summary: {
      acceptedCount: 0,
      fileBackedCount: 1,
      linkOnlyCount: 0,
      noteOnlyCount: 0,
      rejectedCount: 0,
      supersededCount: 0,
      totalCount: 1,
      unreviewedCount: 1
    }
  };
}
