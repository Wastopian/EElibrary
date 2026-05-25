/**
 * File header: Renders the day-zero project onboarding page. Drop one CSV/XLSX
 * BOM and the server action chains project creation, BOM persistence, and
 * deterministic matching together so a brand-new operator lands on the
 * project's diagnostics view in a single click. Failure paths render explicit
 * recovery copy instead of a generic error so the operator knows what to fix.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import React from "react";
import { SectionHeading, SectionPanel } from "@ee-library/ui";
import { FileUploadField } from "../../../components/FileUploadField";
import { createProjectFromCsv, isApiClientError } from "../../../lib/api-client";
import type { ProjectFromCsvInput } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** ProjectFromCsvSearchParams encodes the recovery state pushed back from the server action. */
type ProjectFromCsvSearchParams = {
  error?: string;
  message?: string;
  headers?: string;
  filename?: string;
  projectKey?: string;
};

const maxBomFileBytes = 4 * 1024 * 1024;

/**
 * Renders the drop-one-BOM onboarding page with a server-action form. Errors
 * are surfaced via search params so the page can render targeted recovery copy
 * server-side without needing a client component.
 */
export default async function ProjectFromCsvPage({
  searchParams
}: {
  searchParams?: Promise<ProjectFromCsvSearchParams>;
}): Promise<React.ReactElement> {
  const resolvedSearchParams = (await searchParams) ?? {};
  const errorBanner = renderErrorBanner(resolvedSearchParams);

  /**
   * Server action that turns the dropped CSV/XLSX into a project, BOM import,
   * and matched usage in one chained call. Redirects to the project detail
   * page on success, or back to /projects/new with an error code on failure.
   */
  async function submitProjectFromCsv(formData: FormData): Promise<void> {
    "use server";

    const file = formData.get("bomFile");
    const projectName = readOptionalFormString(formData.get("projectName"));
    const projectKey = readOptionalFormString(formData.get("projectKey"));
    const description = readOptionalFormString(formData.get("description"));

    if (!(file instanceof File) || file.size === 0) {
      redirect("/projects/new?error=no_file");
    }

    if (file.size > maxBomFileBytes) {
      redirect("/projects/new?error=file_too_large&filename=" + encodeURIComponent(file.name));
    }

    const lowerName = file.name.toLowerCase();
    const isXlsx = lowerName.endsWith(".xlsx");
    const isCsv = lowerName.endsWith(".csv");

    if (!isXlsx && !isCsv) {
      redirect("/projects/new?error=unsupported_format&filename=" + encodeURIComponent(file.name));
    }

    let rawContent: string;
    let sourceFormat: "csv" | "xlsx";

    if (isXlsx) {
      const buffer = await file.arrayBuffer();
      rawContent = Buffer.from(buffer).toString("base64");
      sourceFormat = "xlsx";
    } else {
      rawContent = await file.text();
      sourceFormat = "csv";
    }

    const input: ProjectFromCsvInput = {
      description: description ?? null,
      initialRevisionLabel: null,
      projectKey: projectKey ?? null,
      projectName: projectName ?? null,
      rawContent,
      sourceFilename: file.name,
      sourceFormat
    };

    try {
      const response = await createProjectFromCsv(input);
      redirect(`/projects/${encodeURIComponent(response.project.id)}#project-bom-diagnostics-heading`);
    } catch (error) {
      if (isApiClientError(error)) {
        redirect(buildErrorRedirect(toApiClientError(error), file.name));
      }
      // Re-throw non-API errors so the framework error page surfaces honest detail.
      // redirect() throws a special Next.js navigation error -- never swallow it.
      throw error;
    }
  }

  return (
    <main className="page-layout">
      <section className="page-hero page-hero--slim">
        <div className="page-hero__copy">
          <p className="app-kicker">Day-zero onboarding</p>
          <h1>Drop a BOM, see your project</h1>
          <p className="page-hero__lede">
            Upload one CSV or XLSX parts list. We will create a project,
            persist the rows, and run deterministic matching against your
            internal catalog. You land on the diagnostics view to see what
            matched, what is weak, and what is unmatched. Nothing is approved
            yet — matching is a confirmation step, not approval.
          </p>
          <div className="empty-recovery-actions" aria-label="Day-zero onboarding actions">
            <Link className="button-link button-link--quiet" href="/projects">Back to projects</Link>
          </div>
        </div>
      </section>

      <section className="detail-section" aria-labelledby="project-from-csv-heading">
        <SectionHeading
          id="project-from-csv-heading"
          subtitle="One CSV or XLSX with at least an MPN column. Project name and key are optional — we will derive them from the filename if you leave them blank."
          title="Drop your parts list"
        />
        <SectionPanel
          description="Maximum 4 MB per file. The MPN column header should look like MPN, PartNumber, or ManufacturerPartNumber. Manufacturer, designators, and quantity columns help matching but are not required."
          title="New project from BOM"
        >
          {errorBanner}
          <form action={submitProjectFromCsv} className="project-create-panel__form" encType="multipart/form-data">
            <FileUploadField
              accept=".csv,.xlsx"
              buttonLabel="Choose parts list"
              caption="Parts list file (CSV or XLSX)"
              className="file-field--wide"
              name="bomFile"
              required
            />
            <label className="project-create-panel__field">
              <span>Project name (optional)</span>
              <input autoComplete="off" name="projectName" placeholder="Derived from filename if blank" type="text" />
            </label>
            <label className="project-create-panel__field">
              <span>Project key (optional)</span>
              <input autoComplete="off" name="projectKey" placeholder="Derived from project name if blank" type="text" />
            </label>
            <label className="project-create-panel__field project-create-panel__field--wide">
              <span>Short description (optional)</span>
              <input autoComplete="off" name="description" placeholder="What this board is for" type="text" />
            </label>
            <div className="project-create-panel__actions">
              <button type="submit">Create project from BOM</button>
              <span>The project, draft revision, BOM import, and deterministic match all run in one step.</span>
            </div>
          </form>
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-from-csv-honesty-heading">
        <SectionHeading
          id="project-from-csv-honesty-heading"
          subtitle="What we mean by &quot;matched&quot; and what stays separate."
          title="What this does and does not do"
        />
        <SectionPanel
          description="Day-zero onboarding lands you on diagnostics fast, but it does not collapse the trust boundaries that keep this product honest."
          title="Trust boundaries"
        >
          <ul className="project-create-panel__truth-rail">
            <li>
              <strong>Matched lines are confirmed usage.</strong> Exact MPN + manufacturer matches against your catalog are recorded as project usage history.
            </li>
            <li>
              <strong>Weak and ambiguous rows stay separate.</strong> They are saved as BOM rows so you do not lose context, but they are not promoted to part history without explicit review.
            </li>
            <li>
              <strong>Unmatched rows do not invent parts.</strong> They surface as import candidates so you can decide whether to add the part to the catalog, intake from a provider, or correct the BOM.
            </li>
            <li>
              <strong>Saving and matching is not approval.</strong> Approval, validation, and final verification stay separate steps elsewhere in the project workspace.
            </li>
          </ul>
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Builds the redirect URL for a failed onboarding attempt so the page can
 * render targeted recovery copy without losing what the operator was doing.
 */
function buildErrorRedirect(error: { code: string; message: string; details: Record<string, unknown> }, filename: string): string {
  const params = new URLSearchParams();

  if (error.code === "BOM_MPN_MAPPING_REQUIRED") {
    params.set("error", "missing_mpn_mapping");
    const headerList = readDetailStringArray(error.details["headers"]);
    if (headerList.length > 0) {
      params.set("headers", headerList.join(","));
    }
  } else if (error.code === "PROJECT_KEY_CONFLICT") {
    params.set("error", "project_conflict");
    params.set("message", error.message);
  } else if (error.code === "DB_NOT_CONFIGURED") {
    params.set("error", "not_configured");
  } else if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    params.set("error", "unauthorized");
  } else if (error.code === "BOM_CSV_PARSE_ERROR" || error.code === "BOM_CSV_EMPTY" || error.code === "BOM_CSV_HEADERS_MISSING" || error.code === "BOM_XLSX_PARSE_ERROR" || error.code === "INVALID_PROJECT_FROM_CSV_REQUEST") {
    params.set("error", "invalid_csv");
    params.set("message", error.message);
  } else {
    params.set("error", "unknown");
    params.set("message", error.message);
  }

  params.set("filename", filename);
  return `/projects/new?${params.toString()}`;
}

/**
 * Type-narrows an ApiClientError so error helpers can read .code/.message/.details.
 */
function toApiClientError(error: unknown): {
  code: string;
  message: string;
  details: Record<string, unknown>;
} {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error && "details" in error) {
    const typed = error as { code: unknown; message: unknown; details: unknown };
    return {
      code: typeof typed.code === "string" ? typed.code : "UNKNOWN",
      details: typeof typed.details === "object" && typed.details !== null ? (typed.details as Record<string, unknown>) : {},
      message: typeof typed.message === "string" ? typed.message : "Unknown error"
    };
  }

  return { code: "UNKNOWN", details: {}, message: "Unknown error" };
}

/**
 * Renders the recovery banner for a failed onboarding attempt without pretending
 * the upload succeeded.
 */
function renderErrorBanner(searchParams: ProjectFromCsvSearchParams): React.ReactElement | null {
  const errorCode = searchParams.error;
  if (!errorCode) {
    return null;
  }

  const filename = searchParams.filename;
  const filenameLine = filename ? <p className="muted-copy">Last attempt: {filename}</p> : null;

  if (errorCode === "no_file") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>Pick a CSV or XLSX file before submitting.</p>
      </div>
    );
  }

  if (errorCode === "file_too_large") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>That file is larger than 4 MB. Save a slimmer copy with just the BOM rows and try again.</p>
        {filenameLine}
      </div>
    );
  }

  if (errorCode === "unsupported_format") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>Only .csv and .xlsx files are supported here. Export your BOM to one of those and try again.</p>
        {filenameLine}
      </div>
    );
  }

  if (errorCode === "missing_mpn_mapping") {
    const headers = (searchParams.headers ?? "").split(",").filter((header) => header.trim().length > 0);
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>
          We could not auto-detect an MPN column in your file. Day-zero onboarding only runs when the manufacturer
          part number column is recognizable so that matched rows are honest.
        </p>
        {headers.length > 0 ? (
          <p>
            Headers we found: <code>{headers.join(", ")}</code>. Rename the MPN column to <code>MPN</code>,{" "}
            <code>PartNumber</code>, or <code>ManufacturerPartNumber</code>, then try again.
          </p>
        ) : (
          <p>Your file did not appear to have any column headers we could read.</p>
        )}
        <p className="muted-copy">
          If you cannot rename the column, create the project first from the <Link href="/projects">Projects page</Link>{" "}
          and use the per-project BOM Import panel — it lets you map columns manually.
        </p>
        {filenameLine}
      </div>
    );
  }

  if (errorCode === "project_conflict") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>
          A project with that key already exists. Set a different project key in the form, or open the existing
          project from the <Link href="/projects">Projects page</Link>.
        </p>
        {searchParams.message ? <p className="muted-copy">{searchParams.message}</p> : null}
        {filenameLine}
      </div>
    );
  }

  if (errorCode === "not_configured") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>The project-memory database is not configured, so this onboarding flow cannot save anything yet.</p>
        <p className="muted-copy">
          Open <Link href="/system">System checks</Link> for status, or check with whoever set up your install.
        </p>
        {filenameLine}
      </div>
    );
  }

  if (errorCode === "unauthorized") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>
          You need to <Link href="/sign-in">sign in</Link> with an account that can create projects before using
          day-zero onboarding.
        </p>
        {filenameLine}
      </div>
    );
  }

  if (errorCode === "invalid_csv") {
    return (
      <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
        <p>That file did not parse as a valid BOM.</p>
        {searchParams.message ? <p className="muted-copy">{searchParams.message}</p> : null}
        {filenameLine}
      </div>
    );
  }

  return (
    <div className="project-create-panel__status project-create-panel__status--failed" role="alert">
      <p>Something went wrong creating the project from that file.</p>
      {searchParams.message ? <p className="muted-copy">{searchParams.message}</p> : null}
      {filenameLine}
    </div>
  );
}

/**
 * Reads a string array from the structured ApiClientError details map.
 */
function readDetailStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/**
 * Reads an optional trimmed string from a server-action FormData entry.
 */
function readOptionalFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
