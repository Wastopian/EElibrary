/**
 * File header: Stable user-facing strings for the provider import workflow (used in tests).
 */

/** importUiCopy holds calm, explicit wording for the import-by-MPN panel. */
export const importUiCopy = {
  /** Shown while the import request is in flight. */
  submitting: "Import in progress. This may take a short while.",
  /** Shown after a successful import without implying CAD or export readiness. */
  successLead: "Import finished. The catalog record is ready to inspect. CAD and export readiness are unchanged until evidence exists.",
  /** Shown after a successful import when the client must rerun the current search instead of guessing a part route. */
  successRefreshLead: "Import finished. Refreshing the current catalog search because no canonical part route target was returned.",
  /** Shown when the import attempt fails. */
  failureLead: "Import did not complete.",
  /** Shown when the current page context cannot safely offer catalog acquisition. */
  unavailableLead: "Catalog acquisition is unavailable here.",
  /** Shown when the compact no-match acquisition flow is ready to try one exact provider import. */
  catalogAcquisitionLead: "Try a one-part catalog acquisition using the existing provider import path.",
  /** Client-side validation when both fields are empty. */
  validationNeedLookup: "Enter an MPN or a provider part id.",
  /** Primary submit action label. */
  buttonSubmit: "Import into catalog",
  /** Primary no-match acquisition action label. */
  buttonAcquireNoMatch: "Try importing this part",
  /** Primary next-step link after success. */
  linkOpenPart: "Open part detail",
  /** Link to operational admin after success. */
  linkAdminImports: "View in admin",
  /** Link used when search results must be rerun after a successful import. */
  linkRefreshSearch: "Refresh search results",
  /** Clarifies that no-match acquisition is still catalog ingestion, not a global live search. */
  catalogAcquisitionNote: "Catalog acquisition from no-match only. This is not live global search.",
  /** Explains why no-match acquisition is hidden in local seed mode. */
  catalogAcquisitionUnavailableSeed: "Catalog acquisition is unavailable while the page is using local seed examples. Seed mode does not imply DB-backed import availability.",
  /** Explains why generic keyword misses do not become live provider lookups. */
  catalogAcquisitionUnavailableLookup: "Catalog acquisition from no-match only supports concrete MPN-style lookups from the main search field. It does not run live provider search for generic keywords.",
  /** Explains why an unauthenticated or non-admin session cannot run the import path. */
  catalogAcquisitionUnavailableSession: "Catalog acquisition is unavailable for this session. An admin session is required for provider import.",
  /** Explains why import cannot continue when the backing catalog database is absent. */
  catalogAcquisitionUnavailableDatabase: "Catalog acquisition requires a configured catalog database before provider import can persist a part record.",
  /** Explains why setup mode cannot offer the inline catalog acquisition flow. */
  catalogAcquisitionUnavailableSetup: "Catalog acquisition is unavailable until the API can reach a configured catalog database.",
  /** Explains why the currently selected provider cannot be used for acquisition. */
  catalogAcquisitionUnavailableProvider: "Catalog acquisition is unavailable for the selected provider."
} as const;
