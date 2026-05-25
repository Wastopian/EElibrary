"use client";

/**
 * File header: Compact vendor creation panel.
 *
 * Engineers type a name, pick a category, and (optionally) write a one-line summary.
 * The API derives the slug, so the form does not have to worry about URL safety.
 * On success the page navigates to the new vendor workspace; failures surface inline.
 */

import React, { useCallback, useState } from "react";
import { createVendor, isApiClientError } from "../lib/api-client";
import type { VendorCategory, VendorCreateInput, VendorCreateResponse } from "@ee-library/shared/types";

/** VendorCreateStatus tracks operator feedback for vendor creation. */
type VendorCreateStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; response: VendorCreateResponse }
  | { kind: "failed"; message: string };

/**
 * VENDOR_CATEGORY_OPTIONS mirrors the API's supported categories with friendly labels.
 * The API is the source of truth for the enumeration; this list only affects the UI.
 */
const VENDOR_CATEGORY_OPTIONS: { value: VendorCategory; label: string }[] = [
  { value: "pcb_fab", label: "PCB fab" },
  { value: "sheet_metal", label: "Sheet metal" },
  { value: "machining", label: "Machining" },
  { value: "finishing", label: "Anodize / finishing" },
  { value: "electronics_assembly", label: "Electronics assembly" },
  { value: "distributor", label: "Distributor" },
  { value: "other", label: "Other" }
];

/**
 * Renders the create-vendor form. Submission is admin-gated by the API; failures
 * surface as plain-language messages so engineers always know what to fix.
 */
export function VendorCreatePanel(): React.ReactElement {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<VendorCategory>("pcb_fab");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<VendorCreateStatus>({ kind: "idle" });

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedName = name.trim();
      if (!trimmedName) {
        setStatus({ kind: "failed", message: "Supplier name is required." });
        return;
      }

      setStatus({ kind: "submitting" });

      const input: VendorCreateInput = {
        category,
        name: trimmedName,
        ...(summary.trim() ? { summary: summary.trim() } : {})
      };

      try {
        const response = await createVendor(input);
        setStatus({ kind: "success", response });
        navigateToVendor(response.vendor.slug);
      } catch (error) {
        setStatus({ kind: "failed", message: resolveVendorCreateFailure(error) });
      }
    },
    [category, name, summary]
  );

  return (
    <div className="vendor-create-panel">
      <form className="vendor-create-panel__form" onSubmit={onSubmit}>
        <label className="vendor-create-panel__field">
          <span>Company or shop name</span>
          <input
            autoComplete="off"
            maxLength={120}
            name="vendor-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. JLCPCB, Local Sheet Metal"
            value={name}
          />
        </label>
        <label className="vendor-create-panel__field">
          <span>What kind of supplier?</span>
          <select
            name="vendor-category"
            onChange={(event) => setCategory(event.target.value as VendorCategory)}
            value={category}
          >
            {VENDOR_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="vendor-create-panel__field vendor-create-panel__field--wide">
          <span>One-line reminder (optional)</span>
          <input
            autoComplete="off"
            maxLength={240}
            name="vendor-summary"
            onChange={(event) => setSummary(event.target.value)}
            placeholder="e.g. Good for quick 4-layer prototypes; ask about impedance before ordering."
            value={summary}
          />
        </label>
        <div className="vendor-create-panel__actions">
          <button disabled={status.kind === "submitting"} type="submit">
            {status.kind === "submitting" ? "Saving…" : "Save and open"}
          </button>
          <span>You can add detailed notes on the next screen.</span>
        </div>
      </form>
      <VendorCreateStatusMessage status={status} />
    </div>
  );
}

/** Renders submission feedback inline so the form stays predictable. */
function VendorCreateStatusMessage({ status }: { status: VendorCreateStatus }) {
  if (status.kind === "idle") {
    return null;
  }
  if (status.kind === "submitting") {
    return <p className="vendor-create-panel__status vendor-create-panel__status--pending">Saving supplier…</p>;
  }
  if (status.kind === "success") {
    return (
      <p className="vendor-create-panel__status vendor-create-panel__status--success">
        Created {status.response.vendor.name}. Opening their page…
      </p>
    );
  }
  return <p className="vendor-create-panel__status vendor-create-panel__status--failed">{status.message}</p>;
}

/** Converts API failures into concise engineer-facing copy. */
function resolveVendorCreateFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Could not save the supplier. Check the API and try again.";
  }
  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Adding a supplier requires permission. Sign in as an admin or ask one to add it.";
  }
  if (error.code === "VENDOR_NOTES_NOT_CONFIGURED") {
    return "The supplier list is not set up on the server yet. Ask your admin to turn on the supplier folder, then try again.";
  }
  if (error.code === "VENDOR_SLUG_CONFLICT") {
    return "A supplier with a very similar name already exists. Open that one from the list.";
  }
  if (error.code === "INVALID_VENDOR_NAME") {
    return "Use a name with at least one letter or number.";
  }
  return error.message.replace(/^Vendor create failed \([^)]+\):\s*/u, "");
}

/** Navigates to the created vendor workspace. */
function navigateToVendor(slug: string): void {
  if (typeof window !== "undefined") {
    window.location.assign(`/vendors/${encodeURIComponent(slug)}`);
  }
}
