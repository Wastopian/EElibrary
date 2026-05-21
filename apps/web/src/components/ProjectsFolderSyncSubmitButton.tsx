"use client";

/**
 * File header: Submit button with pending state for the project-folder sync form.
 */

import React from "react";
import { useFormStatus } from "react-dom";

/**
 * Renders the folder-sync submit control while the server action is running.
 */
export function ProjectsFolderSyncSubmitButton(): React.ReactElement {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending} type="submit">
      {pending ? "Updating..." : "Update from project folder"}
    </button>
  );
}
