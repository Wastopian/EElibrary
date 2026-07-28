/**
 * File header: Stable user-facing strings for the provider import workflow (used in tests).
 */

/** importUiCopy holds calm, plain-language wording for the import-by-MPN panel. */
export const importUiCopy = {
  /** Shown while the import request is in flight. */
  submitting: "Importing the part. This can take a moment.",
  /** Shown after a successful import without implying CAD or export readiness. */
  successLead: "Import finished. The part is in the catalog and ready to open. CAD and export readiness are unchanged until evidence exists.",
  /** Shown after a successful import when the client must rerun the current search instead of guessing a part route. */
  successRefreshLead: "Import finished. Refreshing the current search so you can find the new part.",
  /** Shown when the import attempt fails. */
  failureLead: "Import did not finish.",
  /** Shown when the current page context cannot safely offer catalog acquisition. */
  unavailableLead: "Importing a new part is not available here.",
  /** Shown when the compact no-match acquisition flow is ready to try one exact provider import. */
  catalogAcquisitionLead: "Import this exact part number from a supplier.",
  /** Client-side validation when both fields are empty. */
  validationNeedLookup: "Enter a part number or supplier part id.",
  /** Primary submit action label. */
  buttonSubmit: "Import into catalog",
  /** Primary no-match acquisition action label. */
  buttonAcquireNoMatch: "Import exact part number",
  /** Explicit action that runs supported-provider exact lookup from a catalog no-match state. */
  buttonSearchProviders: "Check suppliers for this part",
  /** Action that starts import from one selected provider candidate. */
  buttonImportCandidate: "Import this one",
  /** Action that queues one selected provider candidate for admin-gated acquisition. */
  buttonQueueAcquisition: "Queue for import",
  /** Primary next-step link after success. */
  linkOpenPart: "Open part detail",
  /** Link to operational admin after success. */
  linkAdminImports: "View in admin",
  /** Link used when search results must be rerun after a successful import. */
  linkRefreshSearch: "Refresh search results",
  /** Clarifies that no-match acquisition is still catalog ingestion, not a global live search. */
  catalogAcquisitionNote: "Exact part-number import only. Free sources are JLC/LCSC, DigiKey, Mouser, the local KiCad CAD index, and Local Catalog. Octopart/Nexar is an optional paid source and only appears when Nexar credentials are set up.",
  /** Introduces the explicit provider lookup step from a DB-backed no-match state. */
  providerLookupLead: "Check supported suppliers for this exact part number before deciding to import.",
  /** Clarifies that provider lookup remains explicit and exact-match only. */
  providerLookupExactNote: "This only finds exact part-number or supplier-id matches from the suppliers we support.",
  /** Shown while the explicit provider lookup request is in flight. */
  providerLookupSearching: "Checking suppliers for this exact part number...",
  /** Shown when supported providers have no exact candidate rows for the lookup. */
  providerLookupNoMatch: "No supplier has this exact part number.",
  /** Honest no-match wording when at least one supplier did not answer, so the check was incomplete. */
  providerLookupNoMatchIncomplete: "The suppliers that answered do not have this exact part number. Some suppliers did not answer, so this was not a complete check.",
  /** Leads the per-supplier failure notes when some suppliers did not answer the lookup. */
  providerLookupProviderFailuresLead: "Some suppliers did not answer:",
  /** Shown when explicit provider lookup fails before candidates can be listed. */
  providerLookupFailure: "Supplier check did not finish.",
  /** Shown while the selected provider candidate import is starting. */
  providerAcquisitionCreating: "Starting the import...",
  /** Shown when one visible candidate currently owns the in-flight import lock for this result set. */
  providerAcquisitionActiveLead: "Currently importing",
  /** Badge shown on the currently active candidate row. */
  providerAcquisitionActiveBadge: "Importing now",
  /** Explains why the other candidate buttons stay disabled while one job is still pending. */
  providerAcquisitionLocked: "Wait for this import to finish before starting another one.",
  /** Shown while a queued job is waiting for the worker to claim it. */
  providerAcquisitionQueued: "Waiting in line. The import will start soon.",
  /** Shown while the worker is running the existing provider import flow for the queued job. */
  providerAcquisitionRunning: "Importing now...",
  /** Shown after a queued job succeeds with a usable part detail route target. */
  providerAcquisitionSucceeded: "Import finished. Opening the new part record.",
  /** Shown after a queued job succeeds but no safe route target is available yet. */
  providerAcquisitionSucceededRefresh: "Import finished. Refresh the search to find the new part.",
  /** Shown when a queued acquisition job fails. */
  providerAcquisitionFailed: "Import did not finish.",
  /** Explains why candidates may be visible while import remains unavailable to the current request context. */
  providerLookupImportUnavailable: "Importing one of these still needs an admin sign-in and a connected catalog.",
  /** Explains why no-match acquisition is hidden in local seed mode. */
  catalogAcquisitionUnavailableSeed: "Importing new parts is off while this page is showing sample data.",
  /** Explains why generic keyword misses do not become live provider lookups. */
  catalogAcquisitionUnavailableLookup: "Import only works when you type an exact part number. Broad keyword searches are not sent to suppliers.",
  /** Explains why an unauthenticated or non-admin session cannot run the import path. */
  catalogAcquisitionUnavailableSession: "Importing new parts needs an admin sign-in.",
  /** Explains why import cannot continue when the backing catalog database is absent. */
  catalogAcquisitionUnavailableDatabase: "Importing new parts needs the catalog database to be connected.",
  /** Explains why setup mode cannot offer the inline catalog acquisition flow. */
  catalogAcquisitionUnavailableSetup: "Importing new parts is off until the catalog is reachable.",
  /** Explains why the currently selected provider cannot be used for acquisition. */
  catalogAcquisitionUnavailableProvider: "Importing from the selected supplier is not available."
} as const;
