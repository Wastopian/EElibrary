/**
 * File header: Renders the global evidence vault workspace for provenance review and file-backed evidence.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { EvidenceVaultAttachPanel } from "../../components/EvidenceVaultAttachPanel";
import { EvidenceVaultReviewTable } from "../../components/EvidenceVaultReviewTable";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchBomImportLines, fetchCircuitBlockDetail, fetchCircuitBlocks, fetchEvidenceAttachments, fetchPartSearch, fetchProjectBomHealth, fetchProjectDetail, fetchProjectList, isApiClientError } from "../../lib/api-client";
import { buildEvidenceTargetPickerOptionKey, formatEvidenceTargetTypeLabel } from "../../lib/evidence-target-picker";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { EvidenceTargetPickerOption } from "../../lib/evidence-target-picker";
import type { BomImport, BomLine, EvidenceAttachment, EvidenceAttachmentListFilters, EvidenceAttachmentListResponse, EvidenceAttachmentType, EvidenceReviewStatus, EvidenceStorageState, EvidenceTargetType, ProjectBomRiskFinding, ProjectPartUsage } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** MAX_TARGET_PICKER_PROJECTS bounds server-side child lookups for the evidence picker. */
const MAX_TARGET_PICKER_PROJECTS = 8;

/** MAX_TARGET_PICKER_IMPORTS_PER_PROJECT keeps BOM-line suggestions responsive on large projects. */
const MAX_TARGET_PICKER_IMPORTS_PER_PROJECT = 6;

/** EvidencePageSearchParams mirrors the GET query that drives evidence vault filters. */
type EvidencePageSearchParams = {
  evidenceType?: string | string[];
  q?: string | string[];
  reviewStatus?: string | string[];
  sourceSystem?: string | string[];
  storageState?: string | string[];
  targetType?: string | string[];
};

/** EvidencePageState separates ready, setup, and API failure rendering. */
type EvidencePageState =
  | { filters: EvidenceAttachmentListFilters; health: ApiHealth | null; response: EvidenceAttachmentListResponse; status: "ready" }
  | { code: string; filters: EvidenceAttachmentListFilters; health: ApiHealth | null; message: string; status: "setup_required" };

/** EvidencePageProps carries Next.js search params as an awaited value in this app version. */
interface EvidencePageProps {
  searchParams: Promise<EvidencePageSearchParams>;
}

/**
 * Renders the evidence vault without treating evidence review as validation or export readiness.
 */
export default async function EvidencePage({ searchParams }: EvidencePageProps) {
  const filters = readEvidenceFilters(await searchParams);
  const pageState = await loadEvidencePage(filters);
  const targetOptions = pageState.status === "ready" ? await loadEvidenceTargetPickerOptions(pageState.response) : [];
  const jumpItems = [
    { href: "#evidence-filters-heading", label: "Filters" },
    { href: "#evidence-attach-heading", label: "Attach" },
    { href: "#evidence-results-heading", label: "Evidence" },
    { href: "#evidence-boundaries-heading", label: "Boundaries" }
  ];

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Evidence vault</p>
            <h1>Evidence provenance and review</h1>
            <p className="projects-hero__lede">
              Find, attach, and review link, note, and file-backed evidence across project memory without changing part approval, validation, or export readiness.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Evidence is provenance" tone="review" />
              <StatusBadge label={pageState.health ? `API ${pageState.health.status}` : "API health unavailable"} tone={pageState.health ? "info" : "review"} />
              <StatusBadge label={`Database ${pageState.health?.dependencies.database ?? "unknown"}`} tone={pageState.health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
          </div>
          {pageState.status === "ready" ? <EvidenceVaultSnapshot response={pageState.response} /> : <EvidenceVaultSetupSnapshot />}
        </div>
      </section>

      <WorkspaceJumpNav ariaLabel="Evidence vault sections" items={jumpItems} />

      <section className="detail-section" aria-labelledby="evidence-filters-heading">
        <SectionHeading id="evidence-filters-heading" index="01" subtitle="Filter by target, evidence kind, review state, source system, storage state, or text." title="Vault filters" />
        <SectionPanel description="Filters shape the evidence list only. They do not imply evidence has been accepted or validated." title="Search evidence">
          <EvidenceFilterForm filters={filters} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="evidence-attach-heading">
        <SectionHeading id="evidence-attach-heading" index="02" subtitle={pageState.status === "ready" ? "Attach link, note, or local file evidence to a persisted target id." : "Project memory must be connected before evidence can be attached to persisted targets."} title="Attach evidence" />
        <SectionPanel description={pageState.status === "ready" ? "File uploads use the configured storage layer and persist hash, MIME type, storage key, provenance, and review status." : "Attachment controls stay disabled because target ids and storage provenance cannot be persisted right now."} title={pageState.status === "ready" ? "New evidence" : "Attachment unavailable"}>
          {pageState.status === "ready" ? <EvidenceVaultAttachPanel initialOptions={targetOptions} /> : <EvidenceAttachSetupState state={pageState} />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="evidence-results-heading">
        <SectionHeading id="evidence-results-heading" index="03" subtitle="Review metadata can be edited from the vault without changing underlying trust state." title="Evidence rows" />
        <SectionPanel description={pageState.status === "ready" ? pageState.response.boundary : "Project memory must be connected before evidence can be listed."} title={getEvidenceResultsTitle(pageState)}>
          <EvidenceResults state={pageState} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="evidence-boundaries-heading">
        <SectionHeading id="evidence-boundaries-heading" index="04" subtitle="Evidence supports decisions but does not replace explicit validation or approval." title="Boundaries" />
        <div className="projects-truth-rail projects-truth-rail--compact">
          <div>
            <span>File-backed</span>
            <strong>Stored is not export-ready.</strong>
            <p>A file-backed evidence row preserves bytes and hash, but export bundles still require verified asset records.</p>
          </div>
          <div>
            <span>Review status</span>
            <strong>Accepted evidence is not validation.</strong>
            <p>Evidence review only says the provenance row is useful; validation and approval stay in their own records.</p>
          </div>
          <div>
            <span>Target links</span>
            <strong>Ids must stay explicit.</strong>
            <p>The vault attaches evidence to concrete targets and does not infer hidden project or circuit approval.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Loads evidence rows while preserving setup failure state for project-memory persistence.
 */
async function loadEvidencePage(filters: EvidenceAttachmentListFilters): Promise<EvidencePageState> {
  const healthPromise = fetchApiHealth().catch(() => null);

  try {
    const [health, response] = await Promise.all([healthPromise, fetchEvidenceAttachments(filters)]);

    return {
      filters,
      health,
      response,
      status: "ready"
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        filters,
        health: await healthPromise,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      filters,
      health: await healthPromise,
      message: "The API could not be reached, so evidence cannot be listed.",
      status: "setup_required"
    };
  }
}

/**
 * Loads persisted target suggestions for the attach picker without making them trust signals.
 */
async function loadEvidenceTargetPickerOptions(response: EvidenceAttachmentListResponse): Promise<EvidenceTargetPickerOption[]> {
  const options = new Map<string, EvidenceTargetPickerOption>();

  addEvidenceAttachmentTargetOptions(options, response.attachments);

  const [projectListResult, partSearchResult, circuitBlockListResult] = await Promise.allSettled([
    fetchProjectList(),
    fetchPartSearch({ pageSize: 12, sort: "mpn_asc" }),
    fetchCircuitBlocks()
  ]);

  if (partSearchResult.status === "fulfilled") {
    for (const row of partSearchResult.value) {
      addEvidenceTargetOption(options, {
        detail: `${row.manufacturer.name} - part id ${row.part.id}`,
        label: row.part.mpn,
        source: "Catalog",
        targetId: row.part.id,
        targetType: "part"
      });

      for (const asset of row.assets) {
        addEvidenceTargetOption(options, {
          detail: `${formatAssetType(asset.assetType)} - ${asset.fileFormat} - ${asset.id}`,
          label: `${row.part.mpn} ${formatAssetType(asset.assetType)}`,
          source: "Catalog assets",
          targetId: asset.id,
          targetType: "asset"
        });
      }
    }
  }

  if (projectListResult.status === "fulfilled") {
    for (const summary of projectListResult.value.projects) {
      addEvidenceTargetOption(options, {
        detail: `${summary.project.name} - ${summary.revisionCount} revisions - ${summary.usageCount} confirmed usages`,
        label: summary.project.projectKey,
        source: "Projects",
        targetId: summary.project.id,
        targetType: "project"
      });
    }

    const projectTargetResults = await Promise.allSettled(
      projectListResult.value.projects
        .slice(0, MAX_TARGET_PICKER_PROJECTS)
        .map((summary) => loadProjectEvidenceTargetOptions(summary.project.id, summary.project.projectKey))
    );

    for (const result of projectTargetResults) {
      if (result.status === "fulfilled") {
        for (const option of result.value) {
          addEvidenceTargetOption(options, option);
        }
      }
    }
  }

  if (circuitBlockListResult.status === "fulfilled") {
    for (const summary of circuitBlockListResult.value.circuitBlocks) {
      addEvidenceTargetOption(options, {
        detail: `${summary.circuitBlock.name} - ${summary.totalPartCount} roles - ${summary.readinessGapCount} readiness gaps`,
        label: summary.circuitBlock.blockKey,
        source: "Circuit blocks",
        targetId: summary.circuitBlock.id,
        targetType: "circuit_block"
      });
    }

    const circuitBlockDetailResults = await Promise.allSettled(
      circuitBlockListResult.value.circuitBlocks
        .slice(0, MAX_TARGET_PICKER_PROJECTS)
        .map((summary) => fetchCircuitBlockDetail(summary.circuitBlock.id).catch(() => null))
    );

    for (const result of circuitBlockDetailResults) {
      if (result.status === "fulfilled" && result.value) {
        addCircuitBlockPartTargetOptions(options, result.value);
      }
    }
  }

  return Array.from(options.values()).sort(compareEvidenceTargetOptions);
}

/**
 * Loads project child targets that need project-scoped APIs.
 */
async function loadProjectEvidenceTargetOptions(projectId: string, projectKey: string): Promise<EvidenceTargetPickerOption[]> {
  const options: EvidenceTargetPickerOption[] = [];
  const [detailResult, bomHealthResult] = await Promise.allSettled([
    fetchProjectDetail(projectId).catch(() => null),
    fetchProjectBomHealth(projectId).catch(() => null)
  ]);
  const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
  const bomHealth = bomHealthResult.status === "fulfilled" ? bomHealthResult.value : null;

  if (detail) {
    for (const bomImport of detail.bomImports) {
      options.push(buildBomImportTargetOption(bomImport, projectKey));
    }

    for (const usage of detail.usages) {
      options.push(buildProjectUsageTargetOption(usage, projectKey));
    }

    options.push(...await loadBomLineEvidenceTargetOptions(detail.bomImports, projectKey));
  }

  if (bomHealth) {
    for (const finding of bomHealth.findings) {
      options.push(buildRiskFindingTargetOption(finding, projectKey));
    }
  }

  return options;
}

/**
 * Loads BOM-line targets for a bounded set of imports.
 */
async function loadBomLineEvidenceTargetOptions(bomImports: BomImport[], projectKey: string): Promise<EvidenceTargetPickerOption[]> {
  const lineResults = await Promise.allSettled(
    bomImports
      .slice(0, MAX_TARGET_PICKER_IMPORTS_PER_PROJECT)
      .map((bomImport) => fetchBomImportLines(bomImport.id).catch(() => null))
  );
  const options: EvidenceTargetPickerOption[] = [];

  for (const result of lineResults) {
    if (result.status === "fulfilled" && result.value) {
      for (const line of result.value.lines) {
        options.push(buildBomLineTargetOption(line, projectKey));
      }
    }
  }

  return options;
}

/**
 * Adds targets already present in the vault so repeated attachments remain discoverable.
 */
function addEvidenceAttachmentTargetOptions(options: Map<string, EvidenceTargetPickerOption>, attachments: EvidenceAttachment[]): void {
  for (const attachment of attachments) {
    addEvidenceTargetOption(options, {
      detail: `${attachment.evidenceType} evidence - ${attachment.title}`,
      label: `${formatEvidenceTargetTypeLabel(attachment.targetType)} ${attachment.targetId}`,
      source: "Current vault",
      targetId: attachment.targetId,
      targetType: attachment.targetType
    });
  }
}

/**
 * Adds circuit block role targets from a loaded block detail response.
 */
function addCircuitBlockPartTargetOptions(options: Map<string, EvidenceTargetPickerOption>, detail: Awaited<ReturnType<typeof fetchCircuitBlockDetail>>): void {
  if (!detail) {
    return;
  }

  for (const record of detail.parts) {
    addEvidenceTargetOption(options, {
      detail: `${detail.circuitBlock.blockKey} - ${record.part.mpn} - ${record.blockPart.substitutionPolicy.replace(/_/gu, " ")}`,
      label: record.blockPart.role,
      source: "Circuit block roles",
      targetId: record.blockPart.id,
      targetType: "circuit_block_part"
    });
  }
}

/**
 * Builds a picker option for one BOM import record.
 */
function buildBomImportTargetOption(bomImport: BomImport, projectKey: string): EvidenceTargetPickerOption {
  return {
    detail: `${projectKey} - ${bomImport.importStatus} - ${bomImport.id}`,
    label: bomImport.sourceFilename,
    source: "Project BOM imports",
    targetId: bomImport.id,
    targetType: "bom_import"
  };
}

/**
 * Builds a picker option for one BOM line record.
 */
function buildBomLineTargetOption(line: BomLine, projectKey: string): EvidenceTargetPickerOption {
  const identity = line.rawMpn ?? line.rawDescription ?? line.id;

  return {
    detail: `${projectKey} row ${line.rowNumber} - ${line.matchStatus} - ${formatDesignators(line.designators)}`,
    label: identity,
    source: "BOM lines",
    targetId: line.id,
    targetType: "bom_line"
  };
}

/**
 * Builds a picker option for one confirmed project usage record.
 */
function buildProjectUsageTargetOption(usage: ProjectPartUsage, projectKey: string): EvidenceTargetPickerOption {
  const identity = usage.partMpn ?? usage.partId;
  const maker = usage.manufacturerName ? ` - ${usage.manufacturerName}` : "";

  return {
    detail: `${projectKey}${maker} - ${formatDesignators(usage.designators)} - ${usage.usageStatus}`,
    label: identity,
    source: "Confirmed project usage",
    targetId: usage.id,
    targetType: "project_part_usage"
  };
}

/**
 * Builds a picker option for one explainable BOM health finding.
 */
function buildRiskFindingTargetOption(finding: ProjectBomRiskFinding, projectKey: string): EvidenceTargetPickerOption {
  return {
    detail: `${projectKey} - ${finding.code} - ${finding.severity}`,
    label: finding.title,
    source: "BOM health findings",
    targetId: finding.id,
    targetType: "risk_finding"
  };
}

/**
 * Adds one picker option if it has a usable persisted id.
 */
function addEvidenceTargetOption(options: Map<string, EvidenceTargetPickerOption>, option: EvidenceTargetPickerOption): void {
  const targetId = option.targetId.trim();

  if (!targetId) {
    return;
  }

  const normalizedOption = {
    ...option,
    targetId
  };
  const optionKey = buildEvidenceTargetPickerOptionKey(normalizedOption.targetType, normalizedOption.targetId);

  if (!options.has(optionKey)) {
    options.set(optionKey, normalizedOption);
  }
}

/**
 * Sorts picker options by target family, label, and id for stable rendering.
 */
function compareEvidenceTargetOptions(left: EvidenceTargetPickerOption, right: EvidenceTargetPickerOption): number {
  return formatEvidenceTargetTypeLabel(left.targetType).localeCompare(formatEvidenceTargetTypeLabel(right.targetType)) ||
    left.label.localeCompare(right.label) ||
    left.targetId.localeCompare(right.targetId);
}

/**
 * Formats asset type values for compact target labels.
 */
function formatAssetType(assetType: string): string {
  return assetType.replace(/_/gu, " ");
}

/**
 * Formats BOM designators without hiding an empty designator set.
 */
function formatDesignators(designators: string[]): string {
  return designators.length > 0 ? designators.join(", ") : "no designator";
}

/**
 * Renders evidence filter controls as a shareable GET form.
 */
function EvidenceFilterForm({ filters }: { filters: EvidenceAttachmentListFilters }) {
  return (
    <form className="evidence-filter-form" method="get">
      <label>
        <span>Target</span>
        <select defaultValue={filters.targetType ?? ""} name="targetType">
          <option value="">Any target</option>
          <option value="project">Project</option>
          <option value="bom_import">BOM import</option>
          <option value="bom_line">BOM line</option>
          <option value="project_part_usage">Project usage</option>
          <option value="risk_finding">Risk finding</option>
          <option value="circuit_block">Circuit block</option>
          <option value="circuit_block_part">Circuit block part</option>
          <option value="part">Part</option>
          <option value="asset">Asset</option>
        </select>
      </label>
      <label>
        <span>Evidence</span>
        <select defaultValue={filters.evidenceType ?? ""} name="evidenceType">
          <option value="">Any evidence</option>
          <option value="link">Link</option>
          <option value="note">Note</option>
          <option value="file">File</option>
        </select>
      </label>
      <label>
        <span>Review</span>
        <select defaultValue={filters.reviewStatus ?? ""} name="reviewStatus">
          <option value="">Any review</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="superseded">Superseded</option>
        </select>
      </label>
      <label>
        <span>Storage</span>
        <select defaultValue={filters.storageState ?? ""} name="storageState">
          <option value="">Any storage</option>
          <option value="file_backed">File-backed</option>
          <option value="link_only">Link-only</option>
          <option value="note_only">Note-only</option>
        </select>
      </label>
      <label>
        <span>Source</span>
        <input defaultValue={filters.sourceSystem ?? ""} name="sourceSystem" placeholder="manual_internal" />
      </label>
      <label className="evidence-filter-form__query">
        <span>Query</span>
        <input defaultValue={filters.query ?? ""} name="q" placeholder="Title, target id, storage key, or URL" type="search" />
      </label>
      <button className="button-primary" type="submit">Apply filters</button>
    </form>
  );
}

/**
 * Renders setup guidance instead of attach controls when persisted targets are unavailable.
 */
function EvidenceAttachSetupState({ state }: { state: Extract<EvidencePageState, { status: "setup_required" }> }) {
  return (
    <EmptyState
      body={`${state.code}: ${state.message} Evidence attachment requires a persisted target id, provenance row, and storage state before it can be recorded.`}
      title="Connect project memory before attaching evidence"
    />
  );
}

/**
 * Renders the results state for setup, empty, and populated evidence lists.
 */
function EvidenceResults({ state }: { state: EvidencePageState }) {
  if (state.status === "setup_required") {
    return <EmptyState title="Connect project memory" body={`${state.code}: ${state.message}`} />;
  }

  if (state.response.attachments.length === 0) {
    return <EvidenceEmptyRecovery />;
  }

  return <EvidenceVaultReviewTable attachments={state.response.attachments} />;
}

/**
 * Renders empty evidence guidance with visible actions for filter recovery and attachment.
 */
function EvidenceEmptyRecovery() {
  return (
    <div className="empty-recovery-state">
      <EmptyState title="No evidence matched" body="Clear one filter, or attach a link, note, or file to a saved project, BOM row, part, asset, risk, or circuit target." />
      <div className="empty-recovery-actions" aria-label="Evidence recovery actions">
        <a className="button-link" href="#evidence-filters-heading">Review filters</a>
        <a className="button-link button-link--quiet" href="#evidence-attach-heading">Attach evidence</a>
        <Link className="button-link button-link--quiet" href="/projects">Open projects</Link>
      </div>
    </div>
  );
}

/**
 * Renders vault counts without turning review state into trust state.
 */
function EvidenceVaultSnapshot({ response }: { response: EvidenceAttachmentListResponse }) {
  return (
    <div className="projects-stat-grid">
      <EvidenceVaultStat label="Evidence" tone="info" value={response.summary.totalCount.toString()} />
      <EvidenceVaultStat label="File-backed" tone={response.summary.fileBackedCount > 0 ? "verified" : "neutral"} value={response.summary.fileBackedCount.toString()} />
      <EvidenceVaultStat label="Unreviewed" tone={response.summary.unreviewedCount > 0 ? "review" : "neutral"} value={response.summary.unreviewedCount.toString()} />
      <EvidenceVaultStat label="Rejected" tone={response.summary.rejectedCount > 0 ? "danger" : "neutral"} value={response.summary.rejectedCount.toString()} />
    </div>
  );
}

/**
 * Renders neutral counts when evidence cannot be loaded.
 */
function EvidenceVaultSetupSnapshot() {
  return (
    <div className="projects-stat-grid">
      <EvidenceVaultStat label="Evidence" tone="neutral" value="-" />
      <EvidenceVaultStat label="Files" tone="neutral" value="-" />
      <EvidenceVaultStat label="Review" tone="review" value="Setup" />
      <EvidenceVaultStat label="Export" tone="neutral" value="No change" />
    </div>
  );
}

/**
 * Renders one compact vault stat tile.
 */
function EvidenceVaultStat({ label, tone, value }: { label: string; tone: BadgeTone; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Builds the evidence results title for ready and setup states.
 */
function getEvidenceResultsTitle(state: EvidencePageState): string {
  if (state.status === "setup_required") {
    return "Evidence unavailable";
  }

  return state.response.attachments.length > 0 ? `${state.response.attachments.length} evidence rows` : "No evidence rows";
}

/**
 * Reads evidence filters from Next.js search params.
 */
function readEvidenceFilters(params: EvidencePageSearchParams): EvidenceAttachmentListFilters {
  return {
    evidenceType: readEvidenceAttachmentType(readSingleParam(params.evidenceType)),
    query: normalizeFilterText(readSingleParam(params.q)),
    reviewStatus: readEvidenceReviewStatus(readSingleParam(params.reviewStatus)),
    sourceSystem: normalizeFilterText(readSingleParam(params.sourceSystem)),
    storageState: readEvidenceStorageState(readSingleParam(params.storageState)),
    targetType: readEvidenceTargetType(readSingleParam(params.targetType))
  };
}

/**
 * Reads a single search param from Next.js string-or-array values.
 */
function readSingleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/**
 * Normalizes optional filter text so blank fields disappear from API requests.
 */
function normalizeFilterText(value: string): string | null {
  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

/**
 * Reads target type filters without accepting arbitrary labels.
 */
function readEvidenceTargetType(value: string): EvidenceTargetType | null {
  return value === "part" ||
    value === "asset" ||
    value === "project" ||
    value === "bom_import" ||
    value === "bom_line" ||
    value === "project_part_usage" ||
    value === "risk_finding" ||
    value === "circuit_block" ||
    value === "circuit_block_part" ? value : null;
}

/**
 * Reads evidence type filters without accepting arbitrary labels.
 */
function readEvidenceAttachmentType(value: string): EvidenceAttachmentType | null {
  return value === "note" || value === "link" || value === "file" ? value : null;
}

/**
 * Reads review status filters without accepting arbitrary labels.
 */
function readEvidenceReviewStatus(value: string): EvidenceReviewStatus | null {
  return value === "unreviewed" || value === "accepted" || value === "rejected" || value === "superseded" ? value : null;
}

/**
 * Reads evidence storage-state filters without accepting arbitrary labels.
 */
function readEvidenceStorageState(value: string): EvidenceStorageState | null {
  return value === "file_backed" || value === "link_only" || value === "note_only" ? value : null;
}
