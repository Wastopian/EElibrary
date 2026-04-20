/**
 * File header: Stable user-facing strings for the provider import workflow (used in tests).
 */

/** importUiCopy holds calm, explicit wording for the import-by-MPN panel. */
export const importUiCopy = {
  /** Shown while the import request is in flight. */
  submitting: "Import in progress. This may take a short while.",
  /** Shown after a successful import without implying CAD or export readiness. */
  successLead: "Import finished. The catalog record is ready to inspect. CAD and export readiness are unchanged until evidence exists.",
  /** Shown when the import attempt fails. */
  failureLead: "Import did not complete.",
  /** Client-side validation when both fields are empty. */
  validationNeedLookup: "Enter an MPN or a provider part id.",
  /** Primary submit action label. */
  buttonSubmit: "Import into catalog",
  /** Primary next-step link after success. */
  linkOpenPart: "Open part detail",
  /** Link to operational admin after success. */
  linkAdminImports: "View in admin"
} as const;
