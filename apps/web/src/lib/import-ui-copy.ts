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
  catalogAcquisitionLead: "Import this exact part number from a configured supplier.",
  /** Client-side validation when both fields are empty. */
  validationNeedLookup: "Enter a part number or supplier part id.",
  /** Primary submit action label. */
  buttonSubmit: "Import into catalog",
  /** Primary no-match acquisition action label. */
  buttonAcquireNoMatch: "Import exact part number",
  /** Explicit action that runs supported-provider exact lookup from a catalog no-match state. */
  buttonSearchProviders: "Search supported providers",
  /** Action that starts import from one selected provider candidate. */
  buttonImportCandidate: "Import candidate",
  /** Action that queues one selected provider candidate for admin-gated acquisition. */
  buttonQueueAcquisition: "Queue acquisition",
  /** Primary next-step link after success. */
  linkOpenPart: "Open part detail",
  /** Link to operational admin after success. */
  linkAdminImports: "View in admin",
  /** Link used when search results must be rerun after a successful import. */
  linkRefreshSearch: "Refresh search results",
  /** Clarifies that no-match acquisition is still catalog ingestion, not a global live search. */
  catalogAcquisitionNote: "Exact part-number import only. Supported sources are Local Catalog and JLC/LCSC.",
  /** Introduces the explicit provider lookup step from a DB-backed no-match state. */
  providerLookupLead: "Search supported suppliers for exact matches before deciding whether to import.",
  /** Clarifies that provider lookup remains explicit and exact-match only. */
  providerLookupExactNote: "This only checks currently supported suppliers for exact part-number or supplier-id matches.",
  /** Shown while the explicit provider lookup request is in flight. */
  providerLookupSearching: "Searching supported suppliers for exact matches.",
  /** Shown when supported providers have no exact candidate rows for the lookup. */
  providerLookupNoMatch: "No exact-match supplier candidates were found for this lookup.",
  /** Shown when explicit provider lookup fails before candidates can be listed. */
  providerLookupFailure: "Provider lookup did not complete.",
  /** Shown while the selected provider candidate is being turned into a queued acquisition job. */
  providerAcquisitionCreating: "Starting background import.",
  /** Shown when one visible candidate currently owns the in-flight acquisition lock for this result set. */
  providerAcquisitionActiveLead: "Acquisition in progress for",
  /** Badge shown on the currently active candidate row. */
  providerAcquisitionActiveBadge: "Background import running",
  /** Explains why the other candidate buttons stay disabled while one job is still pending. */
  providerAcquisitionLocked: "Wait for this import to finish before starting another one.",
  /** Shown while a queued job is waiting for the worker to claim it. */
  providerAcquisitionQueued: "Import is waiting in line and will start soon.",
  /** Shown while the worker is running the existing provider import flow for the queued job. */
  providerAcquisitionRunning: "Import is in progress.",
  /** Shown after a queued job succeeds with a usable part detail route target. */
  providerAcquisitionSucceeded: "Acquisition finished. Opening the imported part detail record.",
  /** Shown after a queued job succeeds but no safe route target is available yet. */
  providerAcquisitionSucceededRefresh: "Acquisition finished. Refresh the current catalog search to look for the imported part.",
  /** Shown when a queued acquisition job fails. */
  providerAcquisitionFailed: "Acquisition did not complete.",
  /** Explains why candidates may be visible while import remains unavailable to the current request context. */
  providerLookupImportUnavailable: "Candidate import still requires an admin session and connected catalog data.",
  /** Explains why no-match acquisition is hidden in local seed mode. */
  catalogAcquisitionUnavailableSeed: "Catalog import is unavailable while this page is using local sample data.",
  /** Explains why generic keyword misses do not become live provider lookups. */
  catalogAcquisitionUnavailableLookup: "Exact import works for specific part-number searches only. It does not run live supplier search for broad keywords.",
  /** Explains why an unauthenticated or non-admin session cannot run the import path. */
  catalogAcquisitionUnavailableSession: "Catalog acquisition is unavailable for this session. An admin session is required for provider import.",
  /** Explains why import cannot continue when the backing catalog database is absent. */
  catalogAcquisitionUnavailableDatabase: "Catalog import requires connected catalog data before a part record can be saved.",
  /** Explains why setup mode cannot offer the inline catalog acquisition flow. */
  catalogAcquisitionUnavailableSetup: "Catalog import is unavailable until the app can reach catalog data.",
  /** Explains why the currently selected provider cannot be used for acquisition. */
  catalogAcquisitionUnavailableProvider: "Catalog acquisition is unavailable for the selected provider."
} as const;
