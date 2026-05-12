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
    assert.match(html, /Find target/u);
    assert.match(html, /ID override/u);
    assert.match(html, /Project project-alpha/u);
    assert.match(html, /Review PDF/u);
    assert.match(html, /File-backed/u);
    assert.match(html, /Accepted evidence is not validation/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies setup failures disable evidence attachment controls instead of offering fake targets.
 */
test("evidence vault renders setup guidance instead of attach controls when project memory is unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "not_configured",
          objectStorage: "local",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    if (url.pathname === "/evidence-attachments") {
      return jsonResponse(
        {
          error: {
            code: "DB_NOT_CONFIGURED",
            message: "Project memory database is not configured."
          }
        },
        503
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    assert.match(html, /catalog database is not connected yet/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.match(html, /Attachment unavailable/u);
    assert.doesNotMatch(html, /Find target/u);
    assert.doesNotMatch(html, /ID override/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies an empty evidence list gives clear recovery actions without inventing records.
 */
test("evidence vault renders empty recovery actions when no evidence matches", async () => {
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
        data: buildEmptyEvidenceVaultResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({ reviewStatus: "accepted" }) }));

    assert.match(html, /No evidence matched/u);
    assert.match(html, /Review filters/u);
    assert.match(html, /Attach evidence/u);
    assert.match(html, /Open projects/u);
    assert.doesNotMatch(html, /Review PDF/u);
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

/**
 * Builds an empty evidence vault response that still preserves the API boundary copy.
 */
function buildEmptyEvidenceVaultResponse(): EvidenceAttachmentListResponse {
  return {
    attachments: [],
    boundary: "Evidence review is provenance review only; it does not approve parts, validate assets, or unlock export.",
    filters: {
      reviewStatus: "accepted"
    },
    state: "empty",
    summary: {
      acceptedCount: 0,
      fileBackedCount: 0,
      linkOnlyCount: 0,
      noteOnlyCount: 0,
      rejectedCount: 0,
      supersededCount: 0,
      totalCount: 0,
      unreviewedCount: 0
    }
  };
}
