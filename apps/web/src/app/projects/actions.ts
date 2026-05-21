/**
 * File header: Server actions for project-memory workflows that must not call the API from the browser.
 */

"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "../../auth";
import { isApiClientError } from "../../lib/api-client";
import { syncProjectsFromFolderThroughWebProxy } from "../../lib/project-folder-sync";

/**
 * Reconciles the project list with on-disk folders, then returns to the projects page with result copy.
 */
export async function syncProjectsFromFolderAction(): Promise<void> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/sign-in?callbackUrl=/projects");
  }

  try {
    const response = await syncProjectsFromFolderThroughWebProxy();

    revalidatePath("/projects");

    const params = new URLSearchParams();

    if (response.createdCount > 0) {
      params.set("created", String(response.createdCount));
    }

    if (response.linkedCount > 0) {
      params.set("linked", String(response.linkedCount));
    }

    if (response.folderEnsuredCount > 0) {
      params.set("folders", String(response.folderEnsuredCount));
    }

    if (response.skippedCount > 0) {
      params.set("skipped", String(response.skippedCount));
    }

    if (params.size === 0) {
      params.set("sync", "unchanged");
    } else {
      params.set("sync", "ok");
    }

    redirect(`/projects?${params.toString()}`);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    if (isApiClientError(error)) {
      if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
        redirect("/projects?sync_error=admin_required");
      }

      if (error.code === "DB_NOT_CONFIGURED") {
        redirect("/projects?sync_error=db_not_configured");
      }

      redirect(`/projects?sync_error=${encodeURIComponent(error.code)}&sync_message=${encodeURIComponent(error.message)}`);
    }

    redirect("/projects?sync_error=api_unreachable");
  }
}
