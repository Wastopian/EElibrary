/**
 * File header: Server-side project folder sync that always uses the web proxy route.
 */

import { headers } from "next/headers";
import type { ApiEnvelope, ApiErrorEnvelope, ProjectFolderSyncResponse } from "@ee-library/shared/types";
import { ApiClientError } from "./api-client";

/**
 * Runs folder sync through the same-origin Next.js proxy so requests reach the catalog API.
 */
export async function syncProjectsFromFolderThroughWebProxy(): Promise<ProjectFolderSyncResponse> {
  let cookieHeader: string | null = null;

  try {
    cookieHeader = (await headers()).get("cookie");
  } catch {
    cookieHeader = null;
  }

  const base = (process.env["NEXTAUTH_URL"] ?? "http://localhost:3000").replace(/\/$/u, "");
  const response = await fetch(`${base}/api/projects/sync-from-folder`, {
    body: "{}",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    },
    method: "POST"
  });

  if (!response.ok) {
    throw await buildProjectFolderSyncApiError(response);
  }

  const envelope = (await response.json()) as ApiEnvelope<ProjectFolderSyncResponse>;

  return envelope.data;
}

/**
 * Builds a typed API error from the proxy or catalog API response.
 */
async function buildProjectFolderSyncApiError(response: Response): Promise<ApiClientError> {
  const fallbackMessage = `Project folder sync failed with HTTP ${response.status}`;

  try {
    const errorEnvelope = (await response.json()) as Partial<ApiErrorEnvelope> | { error?: unknown };
    const envelopeError = errorEnvelope.error;
    const errorCode =
      typeof envelopeError === "object" && envelopeError !== null && "code" in envelopeError && typeof envelopeError.code === "string"
        ? envelopeError.code
        : `HTTP_${response.status}`;
    const errorMessage =
      typeof envelopeError === "object" && envelopeError !== null && "message" in envelopeError && typeof envelopeError.message === "string"
        ? envelopeError.message
        : fallbackMessage;

    return new ApiClientError("Project folder sync", response.status, errorCode, errorMessage);
  } catch {
    return new ApiClientError("Project folder sync", response.status, `HTTP_${response.status}`, fallbackMessage);
  }
}
